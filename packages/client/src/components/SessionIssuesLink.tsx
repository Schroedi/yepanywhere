import { IssueIcon } from "./IssueIcon";
import styles from "./SessionIssuesLink.module.css";
import { Link } from "react-router-dom";
import { useIssuesEnabled } from "../hooks/useIssuesEnabled";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
export function SessionIssuesLink({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId: string;
}) {
  const enabled = useIssuesEnabled();
  const base = useRemoteBasePath();
  const { t } = useI18n();
  if (!enabled) return null;
  return (
    <Link
      title={t("issuesForSession")}
      aria-label={t("issuesForSession")}
      className={styles.link}
      to={`${base}/issues?${new URLSearchParams({ sessionId, projectId })}`}
    >
      <IssueIcon />
      <span className={styles.label}>{t("issuesTitle")}</span>
    </Link>
  );
}
