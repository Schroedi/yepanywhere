export interface RendezvousUserTurn {
  projectPath: string;
  harness: "claude" | "codex";
  sessionId: string;
  providerSessionId: string;
  receivedAt: number;
}

export function publishRendezvousUserTurn(
  turn: RendezvousUserTurn,
  onError: (error: Error) => void,
): void;

export function flushRendezvousUserTurn(projectPath: string): void;
