import {
  type SessionClearloopBadge,
  formatDurationSeconds,
} from "@yep-anywhere/shared";
import { useI18n } from "../i18n";
import styles from "./ClearloopRemainingBadge.module.css";

/**
 * Green count of `/clearloop` iterations still to run, shown beside a
 * session's title in the sidebar, the Agents view, and the session header
 * (topics/session-rewind.md). Its tooltip states the loop's contract. With
 * `onCancel` it is the header's cancel control: cancelling lets the current
 * turn finish and skips further rewinds.
 */
export function ClearloopRemainingBadge({
  badge,
  onCancel,
}: {
  badge: SessionClearloopBadge;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const contract = t("clearloopBadgeContract", {
    remaining: String(badge.remaining),
    total: String(badge.total),
    window:
      badge.windowSeconds !== undefined
        ? formatDurationSeconds(badge.windowSeconds)
        : t("clearloopBadgeWindowUnknown"),
    index: String(badge.cutTurnIndex),
    prompt: badge.prompt,
  });
  if (onCancel) {
    const label = `${contract} ${t("clearloopRemainingBadgeCancelHint")}`;
    return (
      <button
        type="button"
        className={`${styles.badge} ${styles.cancelable}`}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          onCancel();
        }}
      >
        {badge.remaining}
      </button>
    );
  }
  return (
    <span
      className={styles.badge}
      role="img"
      aria-label={contract}
      title={contract}
    >
      {badge.remaining}
    </span>
  );
}
