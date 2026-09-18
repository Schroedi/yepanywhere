import { useI18n } from "../i18n";
import styles from "./ClearloopRemainingBadge.module.css";

/**
 * Green count of `/clearloop` iterations still to run, shown beside a
 * session's title in the sidebar and the session header
 * (topics/session-rewind.md).
 */
export function ClearloopRemainingBadge({ remaining }: { remaining: number }) {
  const { t } = useI18n();
  const label = t("clearloopRemainingBadge", { count: String(remaining) });
  return (
    <span className={styles.badge} role="img" aria-label={label} title={label}>
      {remaining}
    </span>
  );
}
