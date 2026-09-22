import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import {
  artifactTargetPath,
  createArtifactEditDocument,
  parseArtifactSourceTargets,
  type ArtifactSourceTarget,
} from "../lib/artifactSourceTargets";
import { useModalBackGesture, useModalLayer } from "./ui/Modal";
import styles from "./SourceEditor.module.css";
import { ViewerModeToggle } from "./ViewerModeToggle";

interface SourceReference {
  path?: string;
  projectId?: string;
  artifactUrl?: string;
  relativeTo?: string;
}
interface SourceSnapshot {
  path: string;
  content: string;
  revision: string;
  editable: boolean;
}
interface Props {
  source: SourceReference;
  line?: number;
  column?: number;
  artifact?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

/** Capability-gated edit entry shared by file and artifact viewers. */
export function SourceEditAction({
  source,
  line,
  column,
  artifact,
  onSaved,
  initiallyOpen = false,
}: Omit<Props, "onClose"> & { initiallyOpen?: boolean }) {
  const { t } = useI18n();
  const share = usePublicShareContext();
  const { version } = useVersion();
  const [open, setOpen] = useState(initiallyOpen);
  const saved = useRef(false);
  if (
    share !== null ||
    !serverHasCapability(version, SERVER_CAPABILITIES.fileSourceEditing.name)
  )
    return null;
  return (
    <>
      <ViewerModeToggle
        mode="edit"
        source={source}
        artifact={artifact}
        line={line}
        column={column}
        active={open}
        label={t(artifact ? "sourceEditorEditMode" : "sourceEditorEdit")}
        onToggle={() => {
          saved.current = false;
          setOpen(true);
        }}
      />
      {open && (
        <SourceEditor
          source={source}
          line={line}
          column={column}
          artifact={artifact}
          onSaved={() => {
            saved.current = true;
          }}
          onClose={() => {
            setOpen(false);
            if (saved.current) onSaved?.();
          }}
        />
      )}
    </>
  );
}

/** Full-workspace source editor; preview and session remain independent of typing. */
export function SourceEditor({
  source,
  line = 1,
  column = 1,
  artifact,
  onClose,
  onSaved,
}: Props) {
  const { t } = useI18n();
  const runtime = useCurrentSourceRuntime();
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<{ html: string; path: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stale, setStale] = useState(false);
  const [showPreview, setShowPreview] = useState(Boolean(artifact));
  const [closing, setClosing] = useState(false);
  const [location, setLocation] = useState({
    line,
    column,
    approximate: false,
  });
  const frame = useRef<HTMLIFrameElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const nonce = useMemo(() => crypto.randomUUID().replaceAll("-", ""), []);
  const normalizedOriginal = snapshot?.editable
    ? snapshot.content.replaceAll("\r\n", "\n")
    : "";
  const dirty = snapshot !== null && draft !== normalizedOriginal;
  const close = useCallback(() => {
    if (busy) return;
    if (dirty) setClosing(true);
    else onClose();
  }, [busy, dirty, onClose]);
  useModalLayer(close);
  useModalBackGesture(close, true, "__sourceEditor");

  const load = useCallback(
    async (
      reference: SourceReference,
      position: typeof location,
      initial = false,
    ) => {
      const sequence = ++requestSequence.current;
      setBusy(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(reference))
          if (value) query.set(key, value);
        if (initial && artifact) query.set("preview", "1");
        const result = await runtime.transport.fetch<SourceSnapshot>(
          `/file-edit?${query}`,
        );
        if (sequence !== requestSequence.current) return;
        if (
          /\r(?!\n)/.test(result.content) ||
          (/\r\n/.test(result.content) && /(?<!\r)\n/.test(result.content))
        )
          throw new Error(t("sourceEditorMixedNewlines"));
        setSnapshot(result);
        setDraft(
          result.editable ? result.content.replaceAll("\r\n", "\n") : "",
        );
        setLocation(position);
        setSaved(false);
        if (initial && artifact)
          setPreview({ html: result.content, path: result.path });
        else setShowPreview(false);
      } catch (failure) {
        if (sequence === requestSequence.current)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      } finally {
        if (sequence === requestSequence.current) setBusy(false);
      }
    },
    [runtime, artifact, t],
  );
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    void load(
      JSON.parse(sourceKey) as SourceReference,
      { line, column, approximate: false },
      true,
    );
    return () => {
      requestSequence.current += 1;
    };
  }, [sourceKey, line, column, load]);

  const mapping = useMemo(() => {
    if (!preview) return null;
    try {
      return { value: parseArtifactSourceTargets(preview.html), error: null };
    } catch (failure) {
      return {
        value: null,
        error: failure instanceof Error ? failure.message : String(failure),
      };
    }
  }, [preview]);
  const previewDocument = useMemo(
    () =>
      mapping?.value
        ? createArtifactEditDocument(
            mapping.value.document,
            nonce,
            source.artifactUrl,
          )
        : undefined,
    [mapping, nonce, source.artifactUrl],
  );
  useEffect(() => {
    if (mapping && (!mapping.value || mapping.value.targets.length === 0))
      setShowPreview(false);
  }, [mapping]);
  const chooseTarget = useCallback(
    (target: ArtifactSourceTarget) => {
      if (
        !preview ||
        busy ||
        (dirty && !window.confirm(t("sourceEditorDiscardPrompt")))
      )
        return;
      try {
        const path = artifactTargetPath(target.source, mapping?.value?.mapUrl);
        void load(
          { path, relativeTo: preview.path },
          {
            line: target.sourceRange[0][0] + 1,
            column: target.sourceRange[0][1] + 1,
            approximate: true,
          },
        );
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    },
    [preview, busy, dirty, t, mapping, load],
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "ya-source-target" ||
        event.data.nonce !== nonce
      )
        return;
      const target = mapping?.value?.targets.find(
        (item) => item.id === event.data.id,
      );
      if (target) chooseTarget(target);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [nonce, mapping, chooseTarget]);

  useEffect(() => {
    const input = editor.current;
    if (!snapshot?.path || !input || showPreview) return;
    let offset = 0;
    for (let currentLine = 1; currentLine < location.line; currentLine++) {
      const newline = input.value.indexOf("\n", offset);
      if (newline < 0) {
        offset = input.value.length;
        break;
      }
      offset = newline + 1;
    }
    const end = input.value.indexOf("\n", offset);
    offset = Math.min(
      offset + location.column - 1,
      end < 0 ? input.value.length : end,
    );
    input.focus();
    input.setSelectionRange(offset, offset);
    input.scrollTop = Math.max(0, (location.line - 4) * 24);
  }, [snapshot?.path, location, showPreview]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const siblings = [...document.body.children].filter(
      (element) =>
        element !== workspace.current && element instanceof HTMLElement,
    ) as HTMLElement[];
    const previous = siblings.map((element) => element.inert);
    siblings.forEach((element) => {
      element.inert = true;
    });
    return () => {
      siblings.forEach((element, index) => {
        element.inert = previous[index] ?? false;
      });
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);

  const save = async (exit = false) => {
    if (!snapshot?.editable || busy) return;
    setBusy(true);
    setError(null);
    const content = snapshot.content.includes("\r\n")
      ? draft.replaceAll("\n", "\r\n")
      : draft;
    try {
      const result = await runtime.transport.fetch<{ revision: string }>(
        "/file-edit",
        {
          method: "PUT",
          body: JSON.stringify({
            path: snapshot.path,
            revision: snapshot.revision,
            content,
          }),
        },
      );
      setSnapshot({ ...snapshot, content, revision: result.revision });
      setSaved(true);
      if (preview) setStale(true);
      onSaved?.();
      if (exit) onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={workspace}
      className={styles.workspace}
      role="dialog"
      aria-modal="true"
      aria-label={t("sourceEditorTitle")}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "s") {
          event.preventDefault();
          void save();
        }
        if (event.key === "Tab") {
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[role="button"]:not([aria-disabled="true"]), textarea, select, iframe',
            ),
          ].filter((element) => element.getClientRects().length);
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && event.target === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && event.target === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <strong>{t("sourceEditorTitle")}</strong>
          <span title={snapshot?.path}>
            {snapshot?.path ?? source.path ?? t("sourceEditorLoading")}
          </span>
        </div>
        <button
          type="button"
          disabled={busy || !snapshot || !dirty}
          onClick={() => void save()}
        >
          {t("sourceEditorSave")}
        </button>
        <ViewerModeToggle
          mode="edit"
          source={source}
          artifact={artifact}
          line={line}
          column={column}
          disabled={busy}
          active
          label={t(artifact ? "sourceEditorExitMode" : "sourceEditorClose")}
          onToggle={close}
        />
      </header>
      <div className={styles.status} role="status">
        {busy
          ? t("sourceEditorLoading")
          : saved
            ? t("sourceEditorSaved")
            : dirty
              ? t("sourceEditorUnsaved")
              : t("sourceEditorReady")}
        {location.approximate && (
          <span>{t("sourceEditorApproximate", { line: location.line })}</span>
        )}
      </div>
      {snapshot && !snapshot.editable && (
        <div className={styles.notice}>{t("sourceEditorTooLarge")}</div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {preview && (
        <div className={styles.notice}>
          {t(stale ? "sourceEditorStale" : "sourceEditorSnapshot")}
        </div>
      )}
      {closing && (
        <div className={styles.confirm} role="alert">
          <span>{t("sourceEditorDiscardPrompt")}</span>
          <button type="button" onClick={() => void save(true)} disabled={busy}>
            {t("sourceEditorSaveClose")}
          </button>
          <button type="button" onClick={onClose}>
            {t("sourceEditorDiscard")}
          </button>
          <button type="button" onClick={() => setClosing(false)}>
            {t("sourceEditorKeepEditing")}
          </button>
        </div>
      )}
      {preview && (
        <nav className={styles.tabs} aria-label={t("sourceEditorViews")}>
          <button
            type="button"
            aria-pressed={!showPreview}
            onClick={() => setShowPreview(false)}
          >
            {t("sourceEditorSource")}
          </button>
          <button
            type="button"
            aria-pressed={showPreview}
            onClick={() => setShowPreview(true)}
          >
            {t("sourceEditorPreview")}
          </button>
        </nav>
      )}
      <div className={styles.panes} data-preview={showPreview}>
        <div className={styles.sourcePane}>
          <textarea
            ref={editor}
            aria-label={t("sourceEditorSource")}
            value={draft}
            disabled={!snapshot?.editable || busy}
            spellCheck={false}
            wrap="off"
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setSaved(false);
            }}
          />
        </div>
        {preview && (
          <div className={styles.previewPane}>
            {mapping?.error && <p role="alert">{mapping.error}</p>}
            {mapping?.value && (
              <>
                <label className={styles.targetPicker}>
                  {t("sourceEditorChooseTarget")}
                  <select
                    value=""
                    onChange={(event) => {
                      const target = mapping.value.targets.find(
                        (item) => item.id === event.target.value,
                      );
                      if (target) chooseTarget(target);
                    }}
                  >
                    <option value="">{t("sourceEditorChooseTarget")}</option>
                    {mapping.value.targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.id} — {target.source}:
                        {target.sourceRange[0][0] + 1}
                      </option>
                    ))}
                  </select>
                </label>
                {mapping.value.targets.length === 0 && (
                  <p>{t("sourceEditorNoTargets")}</p>
                )}
                <iframe
                  ref={frame}
                  title={t("sourceEditorPreview")}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  srcDoc={previewDocument}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
