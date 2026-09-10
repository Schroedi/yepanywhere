/** Experimental, provider-neutral issue/session association contract. */
export interface IssueSettings {
  enabled: boolean;
  scope: "viewed" | "recent";
  recentDays: number;
}
export interface IssueItem {
  id: string;
  key: string;
  title: string | null;
  url: string | null;
  provider: string;
  kind: string;
  sessionCount: number;
  unresolved: boolean;
}
export interface IssueEvidence {
  id: number;
  sessionId: string;
  projectId: string;
  messageId: string;
  excerpt: string;
  value: string;
  kind: string;
  observedAt: number;
  sourceTime: string | null;
  sourceAvailable?: boolean;
  sessionTitle?: string;
  state: string;
}
export interface IssueCoverage {
  settings: IssueSettings;
  active: boolean;
  error: string | null;
  counts: Array<{ state: string; count: number }>;
}
export interface IssueSearchResult {
  items: IssueItem[];
  coverage: IssueCoverage;
  nextOffset: number | null;
}
export interface IssueEvidenceResult {
  evidence: IssueEvidence[];
  nextOffset: number | null;
}
