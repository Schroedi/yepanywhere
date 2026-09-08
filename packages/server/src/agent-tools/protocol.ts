/** Own-session protocol; independent of the browser API and provider protocol. */
export const AGENT_SELF_VERSION = 1;
export const AGENT_SELF_PATH = "/v1/self";
export const AGENT_SELF_MAX_BYTES = 64 * 1024;

export interface AgentSelfValue {
  value: string | null;
  status: "known" | "default" | "unknown";
  source: string;
  scope: "launch" | "session" | "response";
  observedAt: string;
}

export interface AgentSelfSelection {
  model?: string | null;
  effort?: string | null;
  pendingEffort?: boolean;
}

export interface AgentSelfReport {
  schemaVersion: 1;
  observedAt: string;
  scope: "owning-session";
  sessionId: string;
  launchId: string;
  launcher: "yepanywhere";
  harness: string;
  provider: string;
  launch: { model: AgentSelfValue; effort: AgentSelfValue };
  selected: { model: AgentSelfValue; effort: AgentSelfValue };
  providerEvidence: { model: AgentSelfValue; effort: AgentSelfValue };
  pending: { effort: boolean };
  activeInference: "unknown";
}

export type AgentSelfErrorCode =
  | "unavailable"
  | "unauthorized"
  | "expired"
  | "session-mismatch"
  | "session-not-ready"
  | "owner-unavailable"
  | "unsupported-protocol"
  | "invalid-response"
  | "usage";

export const AGENT_SELF_EXIT_CODES: Record<AgentSelfErrorCode, number> = {
  usage: 2,
  unavailable: 3,
  unauthorized: 4,
  expired: 4,
  "session-mismatch": 4,
  "session-not-ready": 5,
  "owner-unavailable": 5,
  "unsupported-protocol": 6,
  "invalid-response": 6,
};
