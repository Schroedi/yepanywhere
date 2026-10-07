export const NATIVE_HOST_PROTOCOL = 1 as const;
export const NATIVE_NOTIFICATION_STATUS_FEATURE = "notifications.status";
export const NATIVE_NOTIFICATION_PERMISSION_FEATURE =
  "notifications.requestPermission";
/**
 * The bundled document connects with the native profile's resume credential.
 * Native advertises these only to signed bundled code; see
 * topics/mobile-server-pairing.md § Bundled Web Client Transport.
 */
export const NATIVE_SESSION_CREDENTIAL_FEATURE = "session.credential";
export const NATIVE_SESSION_REAUTHENTICATE_FEATURE = "session.reauthenticate";
export const NATIVE_HOST_SWITCH_FEATURE = "host.switch";
const MAX_MESSAGE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 1_500;
const DEFAULT_PERMISSION_TIMEOUT_MS = 2 * 60_000;
// Native may have to resume its own connection before it can answer.
const DEFAULT_CREDENTIAL_TIMEOUT_MS = 30_000;
// Reauthentication waits for the user to complete native sign-in.
const DEFAULT_REAUTHENTICATE_TIMEOUT_MS = 30 * 60_000;

export interface NativeHostDescriptor {
  protocol: typeof NATIVE_HOST_PROTOCOL;
  platform: "android" | "ios";
  appVersion: string;
  buildVersion: number;
  features: string[];
}

export interface NativeNotificationStatus {
  firebase: "configured" | "unavailable";
  permission: "granted" | "not_requested" | "denied" | "not_required";
  channel: "enabled" | "disabled" | "not_supported";
  installation: "ready" | "update_pending" | "not_registered" | "unavailable";
  notificationsEnabled: boolean;
}

/** One way to reach the profile's server, in the order native prefers. */
export type NativeSessionRoute =
  | { kind: "relay"; wsUrl: string; relayUsername: string }
  | { kind: "direct"; wsUrl: string };

/**
 * The native profile's live resume credential. It is held only in memory by
 * the document that requested it and is never written to web storage.
 */
export interface NativeSessionCredential {
  profileId: string;
  label: string;
  username: string;
  sessionId: string;
  /** Base64-encoded 32-byte base session key. */
  sessionKey: string;
  resumeProtocolVersion?: number;
  /** Routes to try in order; the first is native's preferred route. */
  routes: NativeSessionRoute[];
}

interface NativeHostRawMessageEvent {
  data: unknown;
}

export interface NativeHostRawChannel {
  postMessage(message: string): void;
  onmessage: ((event: NativeHostRawMessageEvent) => void) | null;
}

declare global {
  interface Window {
    yaNative?: NativeHostRawChannel;
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface NativeHostClientOptions {
  getChannel?: () => NativeHostRawChannel | undefined;
  timeoutMs?: number;
  permissionTimeoutMs?: number;
  credentialTimeoutMs?: number;
  reauthenticateTimeoutMs?: number;
  lifecycleTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
}

export class NativeHostClient {
  private readonly getChannel: () => NativeHostRawChannel | undefined;
  private readonly timeoutMs: number;
  private readonly permissionTimeoutMs: number;
  private readonly credentialTimeoutMs: number;
  private readonly reauthenticateTimeoutMs: number;
  private readonly lifecycleTarget?: Pick<
    Window,
    "addEventListener" | "removeEventListener"
  >;
  private readonly pending = new Map<string, PendingRequest>();
  private activeChannel?: NativeHostRawChannel;
  private nextRequestId = 1;
  private descriptorPromise?: Promise<NativeHostDescriptor | null>;

  constructor(options: NativeHostClientOptions = {}) {
    this.getChannel = options.getChannel ?? (() => globalThis.window?.yaNative);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.permissionTimeoutMs =
      options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
    this.credentialTimeoutMs =
      options.credentialTimeoutMs ?? DEFAULT_CREDENTIAL_TIMEOUT_MS;
    this.reauthenticateTimeoutMs =
      options.reauthenticateTimeoutMs ?? DEFAULT_REAUTHENTICATE_TIMEOUT_MS;
    this.lifecycleTarget = options.lifecycleTarget ?? globalThis.window;
    this.lifecycleTarget?.addEventListener("pagehide", this.handlePageHide);
  }

  describe(): Promise<NativeHostDescriptor | null> {
    if (!this.getChannel()) return Promise.resolve(null);
    if (!this.descriptorPromise) {
      this.descriptorPromise = this.request("host.describe")
        .then(parseDescriptor)
        .catch(() => null)
        .then((descriptor) => {
          if (descriptor === null) this.descriptorPromise = undefined;
          return descriptor;
        });
    }
    return this.descriptorPromise;
  }

  async notificationStatus(): Promise<NativeNotificationStatus | null> {
    const descriptor = await this.describe();
    if (!descriptor?.features.includes(NATIVE_NOTIFICATION_STATUS_FEATURE)) {
      return null;
    }
    return parseNotificationStatus(
      await this.request(NATIVE_NOTIFICATION_STATUS_FEATURE),
    );
  }

  async requestNotificationPermission(): Promise<NativeNotificationStatus | null> {
    const descriptor = await this.describe();
    if (
      !descriptor?.features.includes(NATIVE_NOTIFICATION_PERMISSION_FEATURE)
    ) {
      return null;
    }
    return parseNotificationStatus(
      await this.request(
        NATIVE_NOTIFICATION_PERMISSION_FEATURE,
        undefined,
        this.permissionTimeoutMs,
      ),
    );
  }

  /** Whether native hands this document its resume credential. */
  async supportsSessionCredential(): Promise<boolean> {
    const descriptor = await this.describe();
    return (
      descriptor?.features.includes(NATIVE_SESSION_CREDENTIAL_FEATURE) ?? false
    );
  }

  async sessionCredential(): Promise<NativeSessionCredential> {
    return parseSessionCredential(
      await this.request(
        NATIVE_SESSION_CREDENTIAL_FEATURE,
        undefined,
        this.credentialTimeoutMs,
      ),
    );
  }

  /**
   * Report that the server rejected `rejectedSessionId`. Native answers with
   * its current credential when that is already a different session (another
   * document or native consumer reauthenticated first); otherwise it shows
   * native sign-in and resolves with the replacement.
   */
  async reauthenticate(
    rejectedSessionId: string,
  ): Promise<NativeSessionCredential> {
    return parseSessionCredential(
      await this.request(
        NATIVE_SESSION_REAUTHENTICATE_FEATURE,
        { rejectedSessionId },
        this.reauthenticateTimeoutMs,
      ),
    );
  }

  async switchHost(): Promise<void> {
    await this.request(NATIVE_HOST_SWITCH_FEATURE);
  }

  dispose(): void {
    this.lifecycleTarget?.removeEventListener("pagehide", this.handlePageHide);
    this.cancelPending("Native host document was destroyed");
    if (this.activeChannel?.onmessage === this.handleMessage) {
      this.activeChannel.onmessage = null;
    }
    this.activeChannel = undefined;
    this.descriptorPromise = undefined;
  }

  private request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    const channel = this.getChannel();
    if (!channel)
      return Promise.reject(new Error("Native host is unavailable"));
    this.bindChannel(channel);

    const id = `web-${this.nextRequestId}`;
    this.nextRequestId += 1;
    const request = JSON.stringify({
      protocol: NATIVE_HOST_PROTOCOL,
      id,
      method,
      ...(params ? { params } : {}),
    });
    if (new TextEncoder().encode(request).byteLength > MAX_MESSAGE_BYTES) {
      return Promise.reject(new Error("Native host request exceeds 16 KiB"));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Native host request timed out"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        channel.postMessage(request);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(
          error instanceof Error
            ? error
            : new Error("Native host request failed"),
        );
      }
    });
  }

  private bindChannel(channel: NativeHostRawChannel): void {
    if (this.activeChannel === channel) return;
    if (this.activeChannel?.onmessage === this.handleMessage) {
      this.activeChannel.onmessage = null;
    }
    this.cancelPending("Native host channel changed");
    this.activeChannel = channel;
    channel.onmessage = this.handleMessage;
  }

  private readonly handleMessage = (event: NativeHostRawMessageEvent): void => {
    if (typeof event.data !== "string") return;
    let response: unknown;
    try {
      response = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isRecord(response) || response.protocol !== NATIVE_HOST_PROTOCOL)
      return;
    if (typeof response.id !== "string") return;

    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);

    if (response.ok === true) {
      pending.resolve(response.result);
      return;
    }
    if (
      response.ok === false &&
      isRecord(response.error) &&
      typeof response.error.code === "string" &&
      typeof response.error.message === "string"
    ) {
      pending.reject(
        new Error(`${response.error.code}: ${response.error.message}`),
      );
      return;
    }
    pending.reject(new Error("Native host returned an invalid response"));
  };

  private readonly handlePageHide = (): void => {
    this.cancelPending("Native host document was hidden");
    this.descriptorPromise = undefined;
  };

  private cancelPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

function parseDescriptor(value: unknown): NativeHostDescriptor {
  if (
    !isRecord(value) ||
    value.protocol !== NATIVE_HOST_PROTOCOL ||
    (value.platform !== "android" && value.platform !== "ios") ||
    typeof value.appVersion !== "string" ||
    typeof value.buildVersion !== "number" ||
    !Array.isArray(value.features) ||
    !value.features.every((feature) => typeof feature === "string")
  ) {
    throw new Error("Native host descriptor is invalid");
  }
  return {
    protocol: NATIVE_HOST_PROTOCOL,
    platform: value.platform,
    appVersion: value.appVersion,
    buildVersion: value.buildVersion,
    features: [...value.features],
  };
}

function parseNotificationStatus(value: unknown): NativeNotificationStatus {
  if (
    !isRecord(value) ||
    (value.firebase !== "configured" && value.firebase !== "unavailable") ||
    !["granted", "not_requested", "denied", "not_required"].includes(
      value.permission as string,
    ) ||
    !["enabled", "disabled", "not_supported"].includes(
      value.channel as string,
    ) ||
    !["ready", "update_pending", "not_registered", "unavailable"].includes(
      value.installation as string,
    ) ||
    typeof value.notificationsEnabled !== "boolean"
  ) {
    throw new Error("Native notification status is invalid");
  }
  return {
    firebase: value.firebase,
    permission: value.permission as NativeNotificationStatus["permission"],
    channel: value.channel as NativeNotificationStatus["channel"],
    installation:
      value.installation as NativeNotificationStatus["installation"],
    notificationsEnabled: value.notificationsEnabled,
  };
}

function parseSessionCredential(value: unknown): NativeSessionCredential {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.profileId) ||
    typeof value.label !== "string" ||
    !isNonEmptyString(value.username) ||
    !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.sessionKey) ||
    (value.resumeProtocolVersion !== undefined &&
      !Number.isInteger(value.resumeProtocolVersion)) ||
    !Array.isArray(value.routes) ||
    value.routes.length === 0
  ) {
    throw new Error("Native session credential is invalid");
  }
  return {
    profileId: value.profileId,
    label: value.label,
    username: value.username,
    sessionId: value.sessionId,
    sessionKey: value.sessionKey,
    ...(value.resumeProtocolVersion !== undefined
      ? { resumeProtocolVersion: value.resumeProtocolVersion as number }
      : {}),
    routes: value.routes.map(parseSessionRoute),
  };
}

function parseSessionRoute(value: unknown): NativeSessionRoute {
  if (isRecord(value) && isNonEmptyString(value.wsUrl)) {
    if (value.kind === "relay" && isNonEmptyString(value.relayUsername)) {
      return {
        kind: "relay",
        wsUrl: value.wsUrl,
        relayUsername: value.relayUsername,
      };
    }
    if (value.kind === "direct") {
      return { kind: "direct", wsUrl: value.wsUrl };
    }
  }
  throw new Error("Native session route is invalid");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const client = typeof window === "undefined" ? null : new NativeHostClient();

export const nativeHost = {
  describe(): Promise<NativeHostDescriptor | null> {
    return client?.describe() ?? Promise.resolve(null);
  },
  notifications: {
    status(): Promise<NativeNotificationStatus | null> {
      return client?.notificationStatus() ?? Promise.resolve(null);
    },
    requestPermission(): Promise<NativeNotificationStatus | null> {
      return client?.requestNotificationPermission() ?? Promise.resolve(null);
    },
  },
  session: {
    supported(): Promise<boolean> {
      return client?.supportsSessionCredential() ?? Promise.resolve(false);
    },
    credential(): Promise<NativeSessionCredential> {
      return requireClient().sessionCredential();
    },
    reauthenticate(
      rejectedSessionId: string,
    ): Promise<NativeSessionCredential> {
      return requireClient().reauthenticate(rejectedSessionId);
    },
  },
  host: {
    switch(): Promise<void> {
      return requireClient().switchHost();
    },
  },
};

function requireClient(): NativeHostClient {
  if (!client) throw new Error("Native host is unavailable");
  return client;
}
