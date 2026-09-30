import {
  type FileViewSearchEntry,
  type FileViewSearchResult,
  formatFileViewLineSuffix,
  formatFileViewPart,
  parseFileViewArgument,
} from "@yep-anywhere/shared";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { fileViewSearchPath, readFileViewDraft } from "../lib/fileViewCommand";
import { recentProjectFileMentions } from "../lib/recentProjectPathLinks";

const EMPTY_ITEMS: RenderItem[] = [];

/**
 * Completion for the `/v` file-view command: while the draft is `/v parts…`,
 * list matching files (tracked first) under the composer. Tab puts the
 * highlighted path in the draft; Enter opens it. See `topics/view-command.md`.
 */
export function useFileViewCompletion(options: {
  enabled: boolean;
  projectId?: string | null;
  text: string;
  textarea: RefObject<HTMLTextAreaElement | null>;
  replace: (start: number, end: number, replacement: string) => string | null;
  /** Submit a draft as if the user had sent it. */
  submit: (text: string) => void;
  /** Enter inserts a newline instead of sending (full-pane editing). */
  enterInsertsNewline?: boolean;
  items?: RenderItem[];
  disabled?: boolean;
}) {
  const runtime = useCurrentSourceRuntime();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    result?: FileViewSearchResult;
    error?: string;
  } | null>(null);

  const draft =
    options.enabled && !options.disabled && options.projectId
      ? readFileViewDraft(options.text)
      : null;
  const parsed = draft ? parseFileViewArgument(draft.argument) : null;
  const parts = parsed?.parts ?? [];
  const queryKey =
    draft && focused && parts.length > 0
      ? JSON.stringify([options.projectId, parts])
      : null;
  const visible = queryKey !== null && dismissed !== queryKey;
  useEffect(() => {
    setDismissed((previous) => (previous === queryKey ? previous : null));
    setSelection(null);
  }, [queryKey]);

  const items = options.items ?? EMPTY_ITEMS;
  const recent = useMemo(
    () => (visible ? recentProjectFileMentions(items) : []),
    [items, visible],
  );

  useEffect(() => {
    if (!visible || !queryKey || !options.projectId) return;
    const partsForQuery = JSON.parse(queryKey)[1] as string[];
    let stopped = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const path = fileViewSearchPath(options.projectId, partsForQuery, {
      recent,
    });
    const read = async () => {
      try {
        const result = await runtime.transport.fetch<FileViewSearchResult>(
          path,
          { signal: abort.signal },
        );
        if (stopped) return;
        setSnapshot({ key: queryKey, result });
        if (result.pending) timer = setTimeout(read, 250);
      } catch (error) {
        if (!stopped)
          setSnapshot({
            key: queryKey,
            error: error instanceof Error ? error.message : String(error),
          });
      }
    };
    // Coalesce ordinary typing; requests never gate the keystroke itself.
    timer = setTimeout(read, 75);
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [visible, queryKey, options.projectId, recent, runtime]);

  const current = visible && snapshot?.key === queryKey ? snapshot : null;
  const entries = current?.result?.entries ?? [];
  const selected =
    entries.find((entry) => entry.path === selection) ?? entries[0];

  /** The draft that names exactly `entry`, keeping any line target. */
  function draftFor(entry: FileViewSearchEntry): string {
    return `/${draft?.command ?? "v"} ${formatFileViewPart(entry.path)}${formatFileViewLineSuffix(parsed?.line)}`;
  }

  function accept(entry: FileViewSearchEntry) {
    const textarea = options.textarea.current;
    if (!textarea || !draft || !visible) return;
    const next = draftFor(entry);
    options.replace(0, options.text.length, next);
    textarea.setSelectionRange(next.length, next.length);
    // The accepted path is its own exact query; keep the menu closed on it.
    setDismissed(JSON.stringify([options.projectId, [entry.path]]));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (
      event.nativeEvent.isComposing ||
      !visible ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(queryKey);
      return true;
    }
    if (selected && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const index = entries.indexOf(selected);
      setSelection(
        entries[
          (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) %
            entries.length
        ]?.path ?? null,
      );
      return true;
    }
    if (event.key === "Tab" && selected) {
      event.preventDefault();
      accept(selected);
      return true;
    }
    if (event.key === "Enter" && selected && !options.enterInsertsNewline) {
      event.preventDefault();
      options.submit(draftFor(selected));
      return true;
    }
    return false;
  }

  return {
    visible,
    entries,
    selected: selected?.path,
    accept,
    onKeyDown,
    pending: visible && (!current || !!current.result?.pending),
    truncated: current?.result?.truncated ?? false,
    error: current?.error,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
