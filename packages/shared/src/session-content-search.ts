export interface SessionContentSearchRequest {
  sessionId: string;
  query: string;
  roles: Array<"user" | "assistant">;
  /** Inclusive absolute timestamp bounds for the content being searched. */
  after?: number;
  before?: number;
  cursor?: string;
}

export interface SessionContentMatch {
  id: string;
  role: "user" | "assistant";
  ordinal: number;
  timestamp?: string;
  /** Same excerpt budget as the in-session search rail. */
  preview: string;
}

export interface SessionContentSearchBatch {
  matches: SessionContentMatch[];
  cursor?: string;
  done: boolean;
  partial: boolean;
  unavailable?: string;
  bytesRead: number;
}

export function normalizeSearchPreviewText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
}

export function getCollapsedSearchPreviewText(
  text: string,
  query: string,
  caseSensitive = false,
): string {
  const compactText = normalizeSearchPreviewText(text)
    .replace(/\s+/g, " ")
    .trim();
  const compactQuery = query.replace(/\s+/g, " ").trim();
  if (!compactText || !compactQuery) return compactText;
  const index = (
    caseSensitive ? compactText : compactText.toLowerCase()
  ).indexOf(caseSensitive ? compactQuery : compactQuery.toLowerCase());
  if (index === -1) return compactText;
  const start = Math.max(0, index - 24);
  const end = Math.min(compactText.length, index + compactQuery.length + 118);
  return `${start > 0 ? "..." : ""}${compactText.slice(start, end).trim()}${end < compactText.length ? "..." : ""}`;
}
