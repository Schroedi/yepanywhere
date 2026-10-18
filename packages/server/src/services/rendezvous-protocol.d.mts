export interface RendezvousTarget {
  harness: string;
  providerSessionId: string;
  yaSessionId?: string;
  liveOnly?: boolean;
}

export interface RendezvousSubscription {
  version: 1;
  route: string;
  project: string;
  target: RendezvousTarget;
  path: string;
}

export const MAX_ROUTES: number;

export function routeName(value: string): string;

export function atomicJson(path: string, value: unknown): Promise<void>;

export function subscribe(
  root: string,
  target: RendezvousTarget,
  options?: { route?: string; latest?: boolean; receivedAt?: number },
): Promise<RendezvousSubscription>;

export function publishLatest(
  root: string,
  route: string,
  receivedAt: number,
): Promise<void>;
