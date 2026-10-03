export interface AgentAuthRouterStatus {
  state: "pairing" | "connected" | "revocation-pending" | "disconnected";
  routerId: string | null;
}

export type AgentAuthRouterIssueCode =
  | "unavailable"
  | "revoked"
  | "identity-mismatch"
  | "protocol-mismatch"
  | "unsafe-socket"
  | "unsupported"
  | "account-unavailable"
  | "operation-rejected";

export interface AgentAuthRouterAccount {
  id: string;
  provider: "claude" | "codex";
  enabled: boolean;
  renewal: string;
}

/** Owner-only, on-demand observation. Contains no socket paths or credentials. */
export interface AgentAuthRouterRecovery extends AgentAuthRouterStatus {
  checkedAt: string;
  reachable: boolean | null;
  pendingCancellations: number;
  accounts: AgentAuthRouterAccount[];
  issue?: { code: AgentAuthRouterIssueCode; message: string };
}
