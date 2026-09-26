import {
  parseClearloopArguments,
  parseTurnIndexArgument,
  type SessionRewindRecord,
} from "@yep-anywhere/shared";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ClearloopBadgeControls } from "../components/ClearloopRemainingBadge";
import type { SessionRewindContextValue } from "../contexts/SessionRewindContext";
import { useToastContext } from "../contexts/ToastContext";
import { useI18n } from "../i18n";
import { activityBus } from "../lib/activityBus";
import { turnContentText } from "../lib/sessionMessageText";
import {
  getSessionTurnIndex,
  rewindThenDraftPrompt,
} from "../lib/sessionRewind";
import type { Message } from "../types";
import type { DraftControls } from "./useDraftPersistence";
import { useRemoteBasePath } from "./useRemoteBasePath";

export type SessionRewindCommand = "clear" | "fork" | "clearloop";

export interface UseSessionRewindControlsOptions {
  projectId: string;
  sessionId: string;
  messages: Message[];
  /** Server and provider support in-place rewind; gates the turn-menu entries. */
  supportsRewind: boolean;
  /** Provider and model a `/clear 0` new session starts with. */
  provider: string | undefined;
  model: string | undefined;
  applyRewindLocally: (record: SessionRewindRecord) => boolean;
  reloadSession: () => void;
  draftControlsRef: RefObject<DraftControls | null>;
  recordCommandRecall: (commandText: string) => void;
  createDirectTurnFork: (
    sourceMessageId: string,
    forkKind: "before-user-turn" | "after-user-turn",
  ) => Promise<void>;
}

export interface SessionRewindControls {
  /** Value for `SessionRewindProvider`: turn index, Clear entries, groups. */
  contextValue: SessionRewindContextValue;
  /** Runs `/clear N`, `/fork N` or `/clearloop`; always consumes the command. */
  handleRewindCommand: (
    command: SessionRewindCommand,
    argument: string,
  ) => boolean;
  clearloopControls: ClearloopBadgeControls;
  cancelClearloop: () => Promise<void>;
}

/**
 * Same-session rewind for one session page (topics/session-rewind.md): the
 * stable turn index N, the turn-menu Clear entries, `/clear N`, `/fork N`,
 * `/clearloop`, and applying rewinds performed elsewhere.
 */
export function useSessionRewindControls({
  projectId,
  sessionId,
  messages,
  supportsRewind,
  provider,
  model,
  applyRewindLocally,
  reloadSession,
  draftControlsRef,
  recordCommandRecall,
  createDirectTurnFork,
}: UseSessionRewindControlsOptions): SessionRewindControls {
  const { t } = useI18n();
  const { showToast } = useToastContext();
  const basePath = useRemoteBasePath();
  const navigate = useNavigate();

  const sessionTurnIndex = useMemo(
    () => getSessionTurnIndex(messages),
    [messages],
  );
  const [expandedRewoundGroups, setExpandedRewoundGroups] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const toggleRewoundGroup = useCallback((groupId: string) => {
    setExpandedRewoundGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);
  const rewindToCut = useCallback(
    async (
      cut: {
        kind: "after-user-turn" | "before-user-turn";
        sourceMessageId: string;
      },
      cutTurnIndex: number,
    ): Promise<boolean> => {
      try {
        const result = await api.rewindSession(projectId, sessionId, {
          cut,
          cutTurnIndex,
        });
        if (result.noop) {
          showToast(t("rewindNoop"), "success");
          return true;
        }
        showToast(
          t("rewindDone", {
            count: String(result.record?.droppedTurnCount ?? 0),
          }),
          "success",
        );
        // Restructure the loaded transcript in place; only a cut older than
        // the loaded window needs the server's projection refetched.
        if (!result.record || !applyRewindLocally(result.record)) {
          reloadSession();
        }
        return true;
      } catch (error) {
        showToast(
          t("rewindFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
          "error",
        );
        return false;
      }
    },
    [applyRewindLocally, projectId, reloadSession, sessionId, showToast, t],
  );
  const clearAfterUserMessage = useCallback(
    (messageId: string) => {
      const index = sessionTurnIndex.indexById.get(messageId) ?? 0;
      void rewindToCut(
        { kind: "after-user-turn", sourceMessageId: messageId },
        index,
      );
    },
    [rewindToCut, sessionTurnIndex],
  );
  const clearReplacingUserMessage = useCallback(
    (messageId: string) => {
      const index = sessionTurnIndex.indexById.get(messageId) ?? 1;
      if (index <= 1) {
        // Turn 1 has no earlier boundary; an empty prefix is the
        // new-session Clear (topics/session-rewind.md § Commands).
        showToast(t("rewindClearZero"), "error");
        return;
      }
      const source = messages.find((m) => (m.uuid ?? m.id) === messageId);
      const promptText = turnContentText(source?.message?.content).trim();
      void rewindThenDraftPrompt(
        () =>
          rewindToCut(
            { kind: "before-user-turn", sourceMessageId: messageId },
            index - 1,
          ),
        promptText,
        () => draftControlsRef.current,
      );
    },
    [draftControlsRef, messages, rewindToCut, sessionTurnIndex, showToast, t],
  );
  const startClearloop = useCallback(
    async (
      sourceMessageId: string,
      cutTurnIndex: number,
      parsed: { total: number; prompt: string },
      commandText: string,
    ) => {
      try {
        await api.startClearloop(projectId, sessionId, {
          cut: { kind: "after-user-turn", sourceMessageId },
          cutTurnIndex,
          prompt: parsed.prompt,
          total: parsed.total,
          commandText,
        });
        showToast(
          t("clearloopStarted", {
            total: String(parsed.total),
            index: String(cutTurnIndex),
          }),
          "success",
        );
      } catch (error) {
        showToast(
          t("clearloopFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
          "error",
        );
      }
    },
    [projectId, sessionId, showToast, t],
  );
  // A rewind performed elsewhere (a clearloop iteration, another tab) arrives
  // on the metadata event; apply it to the loaded transcript in place.
  useEffect(
    () =>
      activityBus.on("session-metadata-changed", (data) => {
        if (data.sessionId !== sessionId) return;
        // A refused rewind deletes its record; the grouped rows are live
        // again and only the server projection knows the result.
        if (data.rewindRecordRemoved) {
          reloadSession();
          return;
        }
        if (!data.rewindRecord) return;
        if (!applyRewindLocally(data.rewindRecord)) reloadSession();
      }),
    [applyRewindLocally, reloadSession, sessionId],
  );
  const cancelClearloop = useCallback(async () => {
    try {
      await api.cancelClearloop(projectId, sessionId);
    } catch (error) {
      showToast(
        t("clearloopCancelFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }, [projectId, sessionId, showToast, t]);
  const clearloopControls = useMemo<ClearloopBadgeControls>(
    () => ({
      onCancel: () => {
        if (window.confirm(t("clearloopCancelConfirm"))) {
          void cancelClearloop();
        }
      },
      onSetPatient: (patient: boolean) => {
        void (async () => {
          try {
            await api.updateClearloop(projectId, sessionId, { patient });
          } catch (error) {
            showToast(
              t("clearloopPatienceFailed", {
                message: error instanceof Error ? error.message : String(error),
              }),
              "error",
            );
          }
        })();
      },
      onStartNow: () => {
        void (async () => {
          try {
            await api.updateClearloop(projectId, sessionId, {
              startNow: true,
            });
          } catch (error) {
            showToast(
              t("clearloopStartNowFailed", {
                message: error instanceof Error ? error.message : String(error),
              }),
              "error",
            );
          }
        })();
      },
    }),
    [cancelClearloop, projectId, sessionId, showToast, t],
  );
  const clearToNewSession = useCallback(() => {
    const params = new URLSearchParams({ projectId });
    if (provider) params.set("provider", provider);
    if (model) params.set("model", model);
    navigate(`${basePath}/new-session?${params.toString()}`);
  }, [basePath, model, navigate, projectId, provider]);
  const contextValue = useMemo<SessionRewindContextValue>(
    () => ({
      turnIndexById: sessionTurnIndex.indexById,
      onClearAfter: supportsRewind ? clearAfterUserMessage : undefined,
      onClearReplacing: supportsRewind ? clearReplacingUserMessage : undefined,
      expandedRewoundGroups,
      toggleRewoundGroup,
    }),
    [
      clearAfterUserMessage,
      clearReplacingUserMessage,
      expandedRewoundGroups,
      sessionTurnIndex,
      supportsRewind,
      toggleRewoundGroup,
    ],
  );
  const handleRewindCommand = useCallback(
    (command: SessionRewindCommand, argument: string): boolean => {
      const { idByIndex, clearedIds, lastLiveIndex } = sessionTurnIndex;
      const turnMissing = (index: number) => {
        showToast(
          lastLiveIndex === 0
            ? t("rewindNoTurns")
            : t("rewindTurnNotFound", { index: String(index) }),
          "error",
        );
      };
      // Turn N over the full sequence; a turn inside a cleared span is not
      // a rewind target yet (tree hops are unspecified).
      const resolveTurn = (index: number): string | null => {
        const id = idByIndex.get(index);
        if (index < 1 || !id) {
          turnMissing(index);
          return null;
        }
        if (command !== "fork" && clearedIds.has(id)) {
          showToast(t("rewindTurnCleared", { index: String(index) }), "error");
          return null;
        }
        return id;
      };
      // A malformed command is handed back to the composer rather than lost.
      const restoreDraft = () => {
        draftControlsRef.current?.setDraft(
          `/${command}${argument ? ` ${argument}` : ""}`,
        );
        showToast(t("rewindCommandSyntax"), "error");
      };
      const commandText = `/${command}${argument ? ` ${argument.trim()}` : ""}`;
      if (command === "clearloop") {
        const parsed = parseClearloopArguments(argument);
        if (!parsed) {
          restoreDraft();
          return true;
        }
        // No N means "loop from here": the last turn still in the
        // conversation, which is the N its own Clear-after entry offers. A
        // dropped turn holds a higher ordinal and is not a rewind target.
        const index = parsed.turnIndex ?? lastLiveIndex;
        const sourceMessageId = resolveTurn(index);
        if (!sourceMessageId) return true;
        recordCommandRecall(commandText);
        draftControlsRef.current?.confirmInputClear();
        void startClearloop(
          sourceMessageId,
          index,
          parsed,
          `/clearloop ${argument.trim()}`,
        );
        return true;
      }
      const index = parseTurnIndexArgument(argument, {
        allowEmpty: command === "clear",
      });
      if (index === null) {
        restoreDraft();
        return true;
      }
      if (command === "clear" && index === 0) {
        recordCommandRecall(commandText);
        draftControlsRef.current?.confirmInputClear();
        clearToNewSession();
        return true;
      }
      const sourceMessageId = resolveTurn(index);
      if (!sourceMessageId) return true;
      recordCommandRecall(commandText);
      // The command was consumed here, so the persisted draft is cleared as
      // a sent message would be; otherwise a reload restores it.
      draftControlsRef.current?.confirmInputClear();
      if (command === "fork") {
        void createDirectTurnFork(sourceMessageId, "after-user-turn");
        return true;
      }
      void rewindToCut({ kind: "after-user-turn", sourceMessageId }, index);
      return true;
    },
    [
      clearToNewSession,
      createDirectTurnFork,
      draftControlsRef,
      recordCommandRecall,
      rewindToCut,
      sessionTurnIndex,
      showToast,
      startClearloop,
      t,
    ],
  );

  return {
    contextValue,
    handleRewindCommand,
    clearloopControls,
    cancelClearloop,
  };
}
