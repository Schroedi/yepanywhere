import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getMessageId,
  type Message,
} from "@yep-anywhere/shared/transcript/message";
import type { GlobalSessionItem, PaginationInfo } from "../../api/client";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useI18n } from "../../i18n";
import { getSessionDisplayTitle } from "../../utils";
import { Modal } from "../ui/Modal";
import { renderHighlightedText } from "../SearchPreview";
import previewStyles from "../UserTurnNavigator.module.css";
import type { SearchMatch } from "./model";
import styles from "./SearchPreviews.module.css";

interface TurnText {
  id: string;
  role: "user" | "assistant";
  text: string;
}
function visibleText(message: Message): TurnText | null {
  if (
    (message.type !== "user" && message.type !== "assistant") ||
    message.isMeta ||
    message.isSynthetic
  )
    return null;
  const content = message.message?.content ?? message.content;
  const text =
    typeof content === "string"
      ? content
      : content
          ?.flatMap((block) =>
            block.type === "text" && typeof block.text === "string"
              ? [block.text]
              : [],
          )
          .join("\n");
  if (
    !text ||
    /^(?:# AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>)/.test(
      text.trim(),
    )
  )
    return null;
  return { id: getMessageId(message), role: message.type, text };
}

export interface SearchPreviewTarget {
  session: GlobalSessionItem;
  match: SearchMatch;
}

function matchHref({ session, match }: SearchPreviewTarget, basePath: string) {
  return `${basePath}/projects/${session.projectId}/sessions/${session.id}${match.role === "title" ? "" : `?searchMatch=${encodeURIComponent(match.id)}`}`;
}

export function SearchPreviews({
  session,
  matches,
  query,
  basePath,
  onZoom,
  streaming = false,
}: {
  session: GlobalSessionItem;
  matches: SearchMatch[];
  query: string;
  basePath: string;
  onZoom(target: SearchPreviewTarget): void;
  streaming?: boolean;
}) {
  return (
    <div className={streaming ? styles.streaming : undefined}>
      {matches.map((match) => (
        <MatchPreview
          key={match.id}
          session={session}
          match={match}
          query={query}
          basePath={basePath}
          onZoom={onZoom}
        />
      ))}
    </div>
  );
}

function useTurnContext(
  { session, match }: SearchPreviewTarget,
  active: boolean,
  delay: number,
) {
  const { t } = useI18n();
  const runtime = useCurrentSourceRuntime();
  const [context, setContext] = useState<{
    text: string;
    neighbor?: TurnText;
  }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!active || context || match.role === "title") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        let before: string | undefined;
        let target: TurnText | undefined;
        let nextAssistant: TurnText | undefined;
        const cursors = new Set<string>();
        do {
          const params = new URLSearchParams({
            tailCompactions: "1",
            tailTurns: "64",
          });
          if (before) params.set("beforeMessageId", before);
          const page = await runtime.transport.fetch<{
            messages: Message[];
            pagination?: PaginationInfo;
          }>(
            `/projects/${session.projectId}/sessions/${session.id}?${params}`,
            { signal: controller.signal },
          );
          controller.signal.throwIfAborted();
          const turns = page.messages.flatMap((message) => {
            const text = visibleText(message);
            return text ? [text] : [];
          });
          const index = turns.findIndex((turn) => turn.id === match.id);
          if (index >= 0) {
            target = turns[index];
            const neighbor =
              match.role === "user"
                ? (turns
                    .slice(index + 1)
                    .find((turn) => turn.role === "assistant") ?? nextAssistant)
                : turns
                    .slice(0, index)
                    .reverse()
                    .find((turn) => turn.role === "user");
            if (
              neighbor ||
              match.role === "user" ||
              !page.pagination?.hasOlderMessages
            ) {
              setContext({ text: target!.text, neighbor });
              return;
            }
          } else if (target) {
            const neighbor = [...turns]
              .reverse()
              .find((turn) => turn.role === "user");
            if (neighbor || !page.pagination?.hasOlderMessages) {
              setContext({ text: target.text, neighbor });
              return;
            }
          }
          nextAssistant =
            turns.find((turn) => turn.role === "assistant") ?? nextAssistant;
          before = page.pagination?.hasOlderMessages
            ? page.pagination.truncatedBeforeMessageId
            : undefined;
          if (before && cursors.has(before))
            throw new Error(t("sessionSearchTurnUnavailable"));
          if (before) cursors.add(before);
        } while (before);
        throw new Error(t("sessionSearchTurnUnavailable"));
      })().catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    active,
    delay,
    context,
    match.id,
    match.role,
    runtime,
    session.id,
    session.projectId,
    t,
  ]);
  return { context, error };
}

function MatchPreview({
  session,
  match,
  query,
  basePath,
  onZoom,
}: SearchPreviewTarget & {
  query: string;
  basePath: string;
  onZoom(target: SearchPreviewTarget): void;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const { context } = useTurnContext({ session, match }, hover, 400);
  const href = matchHref({ session, match }, basePath);
  const text = match.role === "title" ? match.fullText : context?.text;
  const label = t(`sessionSearchField_${match.role}`);
  return (
    <div className={styles.match}>
      <Link
        to={href}
        title={text ?? match.preview}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu(true);
        }}
      >
        <span className={`${previewStyles.facsimileTag} ${styles.chip}`}>
          {label}
          {match.role !== "title" && `·${match.ordinal}`}
        </span>
        <span className={styles.snippet}>
          {renderHighlightedText(match.preview, query)}
        </span>
      </Link>
      <button
        type="button"
        aria-label={t("sessionSearchMatchMenu")}
        aria-expanded={menu}
        onClick={() => setMenu((value) => !value)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="4" cy="9" r="1.4" />
          <circle cx="9" cy="9" r="1.4" />
          <circle cx="14" cy="9" r="1.4" />
        </svg>
      </button>
      {menu && (
        <div className={styles.menu}>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onZoom({ session, match });
            }}
          >
            {t("sessionSearchZoom")}
          </button>
        </div>
      )}
    </div>
  );
}

/** The page owns the opened preview; result revalidation must not dismiss it. */
export function SearchZoomPreview({
  target,
  basePath,
  onClose,
}: {
  target: SearchPreviewTarget;
  basePath: string;
  onClose(): void;
}) {
  const { t } = useI18n();
  const { context, error } = useTurnContext(target, true, 0);
  const { session, match } = target;
  const text = match.role === "title" ? match.fullText : context?.text;
  return (
    <Modal
      title={getSessionDisplayTitle(session)}
      onClose={onClose}
      closeOnBackGesture
    >
      <div className={styles.zoom}>
        <Link to={matchHref(target, basePath)}>
          {t(`sessionSearchField_${match.role}`)}
        </Link>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p>{text ?? t("gitStatusLoading")}</p>
        )}
        {context?.neighbor && (
          <>
            <hr />
            <span>{t(`sessionSearchField_${context.neighbor.role}`)}</span>
            <p className={styles.neighbor} title={context.neighbor.text}>
              {context.neighbor.text}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
