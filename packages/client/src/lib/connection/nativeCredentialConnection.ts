import type { NativeSessionCredential } from "../nativeHost";
import { openRelayClientSocket } from "./RelayClientSocket";
import { categorizeResumeError, requiresResumeLogin } from "./remoteErrors";
import {
  SecureConnection,
  type SecureConnectionCallbacks,
  type StoredSession,
} from "./SecureConnection";

/**
 * Resume the native profile's session over its routes in native's order.
 *
 * Mirrors the native policy in topics/mobile-server-pairing.md § Android
 * connection ownership contract: the first route that proves the credential
 * wins, an unreachable route falls through to the next, and the credential is
 * reported as rejected only when no route succeeded and at least one reachable
 * route rejected it. Network failure never becomes reauthentication.
 */
export async function openNativeCredentialConnection(
  credential: NativeSessionCredential,
  callbacks: SecureConnectionCallbacks,
): Promise<SecureConnection> {
  let rejection: unknown;
  let lastFailure: unknown;
  for (const route of credential.routes) {
    const session: StoredSession = {
      wsUrl: route.wsUrl,
      username: credential.username,
      sessionId: credential.sessionId,
      sessionKey: credential.sessionKey,
      ...(credential.resumeProtocolVersion !== undefined
        ? { resumeProtocolVersion: credential.resumeProtocolVersion }
        : {}),
    };
    let connection: SecureConnection | undefined;
    try {
      if (route.kind === "relay") {
        const relay = {
          relayUrl: route.wsUrl,
          relayUsername: route.relayUsername,
        };
        const socket = await openRelayClientSocket(relay);
        connection = await SecureConnection.forResumeOnlyWithSocket(
          socket,
          session,
          callbacks,
          relay,
        );
      } else {
        connection = SecureConnection.forResumeOnly(session, callbacks);
      }
      // The probe completes the resume handshake for the direct route.
      await connection.fetch("/auth/status");
      return connection;
    } catch (error) {
      connection?.close();
      if (requiresResumeLogin(categorizeResumeError(error))) {
        rejection ??= error;
      } else {
        lastFailure = error;
      }
    }
  }
  throw rejection ?? lastFailure ?? new Error("Native profile has no routes");
}
