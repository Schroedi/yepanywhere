import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import styles from "./ProjectFileCompletionMenu.module.css";

/** What a path completion source exposes to its menu. */
export interface PathCompletionMenuModel<Entry extends { path: string }> {
  visible: boolean;
  entries: readonly Entry[];
  selected?: string;
  accept: (entry: Entry) => void;
  pending?: boolean;
  truncated: boolean;
  error?: string;
}

const kindBadge = (entry: { path: string; kind?: string }) =>
  entry.kind === "directory" ? "dir" : "file";

export function ProjectFileCompletionMenu<
  Entry extends { path: string; kind?: string },
>({
  completion,
  badge = kindBadge,
  emptyLabel,
}: {
  completion: PathCompletionMenuModel<Entry>;
  /** The short trailing label for a row; `dir`/`file` by default. */
  badge?: (entry: Entry) => string;
  /** Status text when the settled result is empty. */
  emptyLabel?: string;
}) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!completion.selected) return;
    menu.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [completion.selected]);
  if (!completion.visible) return null;
  return (
    <div
      ref={menu}
      className={styles.menu}
      role="listbox"
      aria-label={t("fileCompletionLabel")}
    >
      {completion.entries.map((entry) => {
        const path = entry.path.replace(/\/$/, "");
        const slash = path.lastIndexOf("/");
        return (
          <button
            key={entry.path}
            type="button"
            role="option"
            aria-selected={entry.path === completion.selected}
            className={styles.row}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => completion.accept(entry)}
          >
            <span className={styles.basename}>{path.slice(slash + 1)}</span>
            <span className={styles.parent}>
              {slash >= 0 ? path.slice(0, slash + 1) : ""}
            </span>
            <span className={styles.kind}>{badge(entry)}</span>
          </button>
        );
      })}
      {(completion.pending ||
        completion.error ||
        completion.entries.length === 0 ||
        completion.truncated) && (
        <div className={styles.status} role="status">
          {completion.error
            ? t("fileCompletionUnavailable")
            : completion.pending
              ? t("fileCompletionSearching")
              : completion.truncated
                ? t("fileCompletionMore")
                : (emptyLabel ?? t("fileCompletionEmpty"))}
        </div>
      )}
    </div>
  );
}
