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
      to={`${base}/issues?${new URLSearchParams({ sessionId, projectId })}`}
    >
      {t("issuesTitle")}
    </Link>
  );
}
