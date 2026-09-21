import {
  type UsageReport,
  type UsageTokenBucket,
  type UsageTotals,
  coveredCalendarDays,
  rawTokenCount,
} from "@yep-anywhere/shared";
import { useI18n } from "../../i18n";
import styles from "./UsersSettings.module.css";

/**
 * Per-principal usage for Settings → Users.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage. Two columns per
 * user: everything the ledger holds, and the last seven days. The first
 * column names the calendar days it spans, because the ledger starts the day
 * the feature lands rather than covering the install's whole history. The
 * second says "7 days" rather than "last week", which a reader otherwise
 * takes for the last whole calendar week.
 */

export interface UserUsageTableProps {
  report: UsageReport;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Interaction time as a short phrase: "3h 20m", "45m", "under a minute". */
export function formatActiveTime(
  ms: number,
  t: (key: never, vars?: Record<string, string | number>) => string,
): string {
  if (ms <= 0) return t("userUsageNone" as never);
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
  if (hours > 0) {
    return minutes > 0
      ? t("userUsageHoursMinutes" as never, { hours, minutes })
      : t("userUsageHours" as never, { hours });
  }
  if (minutes > 0) return t("userUsageMinutes" as never, { minutes });
  return t("userUsageUnderAMinute" as never);
}

/**
 * A token count for a table cell: exact under ten thousand, then thousands or
 * millions to one decimal, because the comparison between rows is the point
 * and nine significant digits of it do not help.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 10_000) return tokens.toLocaleString();
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function UserUsageTable({ report }: UserUsageTableProps) {
  const { t } = useI18n();
  const days = coveredCalendarDays(report.since, report.now);
  // A principal with nothing recorded in either window is noise in the table.
  const rows = report.users.filter(
    (user) => user.total.turns > 0 || user.total.sessions > 0,
  );

  return (
    <div className={styles.usage}>
      <h3 className={styles.editorTitle}>{t("userUsageTitle")}</h3>
      <p className="settings-hint">
        {report.since === null
          ? t("userUsageEmpty")
          : days === 1
            ? t("userUsageSinceDay")
            : t("userUsageSinceDays", { days })}
      </p>
      {rows.length > 0 && (
        <table className={styles.usageTable}>
          <thead>
            <tr>
              <th scope="col">{t("userUsageUser")}</th>
              <th scope="col">
                {days === 1
                  ? t("userUsageAllRecordedDay")
                  : t("userUsageAllRecordedDays", { days })}
              </th>
              <th scope="col">{t("userUsageLastSevenDays")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.username ?? ""}>
                <th scope="row" className={styles.usageUser}>
                  {user.username ?? t("usersSuperuser")}
                </th>
                <td>
                  <UsageCell totals={user.total} />
                </td>
                <td>
                  <UsageCell totals={user.lastWeek} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UsageCell({ totals }: { totals: UsageTotals }) {
  const { t } = useI18n();
  const raw = rawTokenCount(totals.tokens);
  return (
    <ul className={styles.usageFacts}>
      <li>{formatActiveTime(totals.activeMs, t)}</li>
      <li>
        {t("userUsageSessions", {
          count: totals.sessions,
          suffix: totals.sessions === 1 ? "" : "s",
        })}
      </li>
      <li>
        {t("userUsageTurns", {
          count: totals.turns,
          suffix: totals.turns === 1 ? "" : "s",
        })}
      </li>
      <li>
        {t("userUsageWords", {
          count: totals.words.toLocaleString(),
          suffix: totals.words === 1 ? "" : "s",
        })}
      </li>
      {raw > 0 && (
        <>
          <li title={t("userUsageTokenSplit", classSplit(totals.tokens))}>
            {t("userUsageTokens", { count: formatTokenCount(raw) })}
          </li>
          <UsageBreakdown
            label={t("userUsageByModel")}
            buckets={totals.byModel}
          />
          <UsageBreakdown
            label={t("userUsageByProject")}
            buckets={totals.byProject}
          />
        </>
      )}
    </ul>
  );
}

/** The four counts, for the hover that explains the volume figure. */
function classSplit(tokens: UsageTotals["tokens"]) {
  return {
    fresh: tokens.freshInputTokens.toLocaleString(),
    cached: tokens.cachedInputTokens.toLocaleString(),
    written: tokens.cacheWriteTokens.toLocaleString(),
    output: tokens.outputTokens.toLocaleString(),
  };
}

/**
 * What one bucket costs. The output-token equivalent leads where it exists,
 * because it stays meaningful when a price changes; dollars follow it as a
 * supplement, and are simply absent for a model no price is known for. A
 * bucket with neither shows its raw volume, which is all that is known.
 */
function bucketCost(
  bucket: UsageTokenBucket,
  t: (key: never, vars?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  if (bucket.equivalentOutputTokens !== null) {
    parts.push(
      t("userUsageOutputEquivalent" as never, {
        count: formatTokenCount(bucket.equivalentOutputTokens),
      }),
    );
  }
  if (bucket.costUsd !== null) {
    parts.push(formatUsd(bucket.costUsd));
  }
  if (parts.length === 0) {
    parts.push(formatTokenCount(rawTokenCount(bucket.tokens)));
  }
  return parts.join(" ");
}

/** Dollars at a precision that still distinguishes two cheap sessions. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}

/**
 * One line of per-model or per-project cost. The two splits are separate lines
 * rather than a model-by-project grid, which nobody asked to read.
 */
function UsageBreakdown({
  label,
  buckets,
}: {
  label: string;
  buckets: UsageTokenBucket[];
}) {
  const { t } = useI18n();
  const named = buckets.filter((bucket) => rawTokenCount(bucket.tokens) > 0);
  if (named.length === 0) return null;
  return (
    <li className={styles.usageBreakdown}>
      <span className={styles.usageBreakdownLabel}>{label}</span>{" "}
      {named
        .map(
          (bucket) =>
            `${bucket.name || t("userUsageUnattributed")} ${bucketCost(bucket, t)}`,
        )
        .join(" · ")}
    </li>
  );
}
