import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import styles from "./PathBreadcrumbs.module.css";

interface PathBreadcrumbsProps {
  /** A "/"-separated display path; its last segment is the current name. */
  path: string;
  /** Index (in `path.split("/")`) of the folder whose list or menu is open. */
  activeSegment?: number | null;
  /**
   * Makes each folder segment a button. Absent, the path renders as the plain
   * text it always was, which is how a public share shows it.
   */
  onFolderActivate?: (segment: number, anchor: HTMLElement) => void;
  onFolderContextMenu?: (segment: number, event: ReactMouseEvent) => void;
  /** Makes the final name a button too, without link styling. */
  onNameActivate?: (anchor: HTMLElement) => void;
}

function activateOnKey(
  event: ReactKeyboardEvent<HTMLElement>,
  activate: (anchor: HTMLElement) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate(event.currentTarget);
}

/**
 * A file path whose folders can be opened, web-breadcrumb style: folder
 * segments are link-colored buttons, separators are inert, and the current
 * name is plain text. Segments are inline spans rather than buttons so a long
 * name still wraps mid-segment like the plain path does. Navigation belongs
 * to the caller; segment indexes refer to `path.split("/")`, and empty
 * segments (a leading "/") are never targets.
 */
export function PathBreadcrumbs({
  path,
  activeSegment = null,
  onFolderActivate,
  onFolderContextMenu,
  onNameActivate,
}: PathBreadcrumbsProps) {
  if (!onFolderActivate) return <>{path}</>;
  const segments = path.split("/");
  const last = segments.length - 1;
  const name = segments[last] ?? "";
  return (
    <>
      {segments.slice(0, last).map((segment, index) => (
        // A path's segments are positional.
        <Fragment key={`${index}:${segment}`}>
          {segment === "" ? null : (
            // An inline span, not a button, so a long name wraps mid-segment.
            <span
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-expanded={activeSegment === index}
              data-active={activeSegment === index || undefined}
              className={styles.segment}
              onClick={(event) => onFolderActivate(index, event.currentTarget)}
              onKeyDown={(event) =>
                activateOnKey(event, (anchor) =>
                  onFolderActivate(index, anchor),
                )
              }
              onContextMenu={
                onFolderContextMenu
                  ? (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onFolderContextMenu(index, event);
                    }
                  : undefined
              }
            >
              {segment}
            </span>
          )}
          <span className={styles.separator}>/</span>
          <wbr />
        </Fragment>
      ))}
      {onNameActivate ? (
        <span
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-current="page"
          className={styles.name}
          onClick={(event) => onNameActivate(event.currentTarget)}
          onKeyDown={(event) => activateOnKey(event, onNameActivate)}
        >
          {name}
        </span>
      ) : (
        <span className={styles.name} aria-current="page">
          {name}
        </span>
      )}
    </>
  );
}
