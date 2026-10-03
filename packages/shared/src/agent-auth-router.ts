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

export type AgentAuthRouterPoolPolicy = "manual" | "round-robin";
export interface AgentAuthRouterPool {
  id: string;
  name: string;
  provider: "claude" | "codex";
  accountIds: string[];
  policy: AgentAuthRouterPoolPolicy;
  revision: number;
  bindings: { accountId: string; count: number }[];
}
export type AgentAuthRouterPoolInput = Omit<AgentAuthRouterPool, "bindings">;
export interface AgentAuthRouterOverview {
  observedAt: string;
  quotaFreshSeconds: number;
  pools: AgentAuthRouterPool[];
  accounts: (AgentAuthRouterAccount & {
    freshness: "fresh" | "stale" | "unknown";
    models: { id: string; name: string }[];
    catalogAt: string | null;
    attemptedAt: string | null;
    error: string | null;
    blocked?: "auth-unavailable" | "cooldown";
    cooldownUntil?: string;
    quota: { observedAt: string } | null;
    windows: {
      bucket: string;
      windowMinutes: number | null;
      usedPercent: number | null;
      remainingPercent: number | null;
      resetsAt: string | null;
      scope: "all" | "opus" | "sonnet" | "unknown";
    }[];
  })[];
  selection?: {
    poolId: string;
    policy?: AgentAuthRouterPoolPolicy;
    model: string | null;
    decisions: { accountId: string; reason: string }[];
  };
}
