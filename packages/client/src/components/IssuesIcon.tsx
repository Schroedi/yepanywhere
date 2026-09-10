/**
 * The single glyph for the Issues & PRs feature: the "#" that both Jira keys
 * and GitHub issue/PR numbers are written with (exact Lucide "hash", matching
 * the other borrowed glyphs in the settings set).
 *
 * The shape is shared by the settings category icon (22px), the sidebar item
 * (16px), and the session header chip (14px), so one recognizable mark stands
 * for the feature everywhere. It carries no frame of its own: the settings
 * category already draws a rounded tile around it, and an inner card collapses
 * into a dense block at sidebar and chip sizes. Children use a 0 0 24 24
 * viewBox and currentColor so every host can size and color it; CSS still wins
 * over the presentation attributes below when a host restyles the stroke.
 */
export const issuesIconShape = (
  <>
    <line x1="4" x2="20" y1="9" y2="9" />
    <line x1="4" x2="20" y1="15" y2="15" />
    <line x1="10" x2="8" y1="3" y2="21" />
    <line x1="16" x2="14" y1="3" y2="21" />
  </>
);

export function IssuesIcon({
  size = 16,
  strokeWidth = 2,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {issuesIconShape}
    </svg>
  );
}
