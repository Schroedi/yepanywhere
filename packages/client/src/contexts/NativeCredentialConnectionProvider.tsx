/**
 * Connection owner for a bundled app document whose native host hands it the
 * profile's resume credential (topics/mobile-server-pairing.md § Decided
 * replacement). The document connects through the ordinary secure transport,
 * the same reconnect machinery browsers use, under the native profile's source
 * key. The credential lives only in memory here and is never written to web
 * storage. A rejected resume asks native to sign in again; this document never
 * shows a password prompt of its own.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { StartupShell } from "../components/StartupShell";
import { useResumeRecovery } from "../hooks/useResumeRecovery";
import { useI18n } from "../i18n";
import { asClientSummarySourceKey } from "../lib/clientSummarySourceKey";
import { openNativeCredentialConnection } from "../lib/connection/nativeCredentialConnection";
import {
  categorizeResumeError,
  requiresResumeLogin,
} from "../lib/connection/remoteErrors";
import type {
  SecureConnection,
  StoredSession,
} from "../lib/connection/SecureConnection";
import type { Connection } from "../lib/connection/types";
import { type NativeSessionCredential, nativeHost } from "../lib/nativeHost";
import { getSourceRuntimeRegistry } from "../lib/sourceRuntime";
import { SecureSourceTransport } from "../lib/transport";
import {
  RemoteConnectionContext,
  type RemoteConnectionState,
} from "./RemoteConnectionContext";

export function NativeCredentialConnectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [credential, setCredential] = useState<NativeSessionCredential | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void nativeHost.session.credential().then(
      (received) => {
        if (active) setCredential(received);
      },
      (error: unknown) => {
        debugLogNativeCredential("Credential request failed", error);
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useResumeRecovery(failed && !credential, () => setAttempt((n) => n + 1));

  if (!credential)
    return (
      <StartupShell phase="connection">
        {t(failed ? "nativeConnectionUnavailable" : "reconnecting")}
      </StartupShell>
    );
  return (
    <NativeCredentialSource initialCredential={credential}>
      {children}
    </NativeCredentialSource>
  );
}

type Phase = "connecting" | "connected" | "offline" | "reauthenticating";

function NativeCredentialSource({
  initialCredential,
  children,
}: {
  initialCredential: NativeSessionCredential;
  children: ReactNode;
}) {
  const profileId = initialCredential.profileId;
  const [transport] = useState(() => new SecureSourceTransport());
  const [connection] = useState(() => transportConnection(transport));
  const [phase, setPhase] = useState<Phase>("connecting");
  const credentialRef = useRef(initialCredential);
  const connectionRef = useRef<SecureConnection | null>(null);
  const attemptRef = useRef(0);
  const disposedRef = useRef(false);
  const transportState = useSyncExternalStore(
    useCallback(
      (listener: () => void) => transport.status.subscribe(listener),
      [transport],
    ),
    () => transport.status.getSnapshot().state,
  );

  const nativeSource = useMemo(
    () => ({
      sourceKey: asClientSummarySourceKey(`native:${profileId}`),
      registration: {
        kind: "custom" as const,
        createTransport: () => transport,
      },
    }),
    [profileId, transport],
  );

  const rememberSession = useCallback((session: StoredSession) => {
    // A resume may raise the protocol pin; keep it for later resumes in this
    // document only. Native owns the durable credential.
    credentialRef.current = {
      ...credentialRef.current,
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      ...(session.resumeProtocolVersion !== undefined
        ? { resumeProtocolVersion: session.resumeProtocolVersion }
        : {}),
    };
  }, []);

  const reauthenticateRef = useRef<() => void>(() => {});

  const connect = useCallback(async () => {
    const attempt = ++attemptRef.current;
    setPhase("connecting");
    try {
      const opened = await openNativeCredentialConnection(
        credentialRef.current,
        { onSessionEstablished: rememberSession },
      );
      if (disposedRef.current || attempt !== attemptRef.current) {
        opened.close();
        return;
      }
      const previous = connectionRef.current;
      connectionRef.current = opened;
      transport.attach(opened);
      previous?.close();
      setPhase("connected");
    } catch (error) {
      if (disposedRef.current || attempt !== attemptRef.current) return;
      if (requiresResumeLogin(categorizeResumeError(error))) {
        reauthenticateRef.current();
        return;
      }
      debugLogNativeCredential("Connection failed", error);
      setPhase("offline");
    }
  }, [rememberSession, transport]);

  const reauthenticate = useCallback(async () => {
    const attempt = ++attemptRef.current;
    setPhase("reauthenticating");
    try {
      const replacement = await nativeHost.session.reauthenticate(
        credentialRef.current.sessionId,
      );
      if (disposedRef.current || attempt !== attemptRef.current) return;
      if (replacement.profileId !== profileId) {
        throw new Error("Native reauthenticated a different profile");
      }
      credentialRef.current = replacement;
    } catch (error) {
      if (disposedRef.current || attempt !== attemptRef.current) return;
      debugLogNativeCredential("Reauthentication failed", error);
      setPhase("offline");
      return;
    }
    await connect();
  }, [connect, profileId]);
  reauthenticateRef.current = () => {
    void reauthenticate();
  };

  // The attached transport retries on its own; act once it gives up. A
  // rejected resume needs native sign-in, anything else waits for recovery.
  useEffect(() => {
    if (phase !== "connected" || transportState !== "disconnected") return;
    // ConnectionManager reports the state change before the failure that
    // explains it; let that paired event land first.
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (
        transport.failure &&
        requiresResumeLogin(categorizeResumeError(transport.failure))
      ) {
        reauthenticateRef.current();
      } else {
        setPhase("offline");
      }
    });
    return () => {
      active = false;
    };
  }, [phase, transport, transportState]);

  useResumeRecovery(phase === "offline", () => {
    void connect();
  });

  useEffect(() => {
    disposedRef.current = false;
    void connect();
    return () => {
      disposedRef.current = true;
      attemptRef.current += 1;
      connectionRef.current = null;
      // Disposing the source closes the transport and its connection.
      getSourceRuntimeRegistry().disposeSource(nativeSource.sourceKey);
    };
  }, [connect, nativeSource.sourceKey]);

  const switchHost = useCallback(() => {
    void nativeHost.host.switch().catch((error: unknown) => {
      debugLogNativeCredential("Host switch failed", error);
    });
  }, []);

  const value = useMemo<RemoteConnectionState>(
    () => ({
      nativeSource,
      switchHost,
      // Mounted before the first resume completes, so pages and drafts render
      // offline; requests wait for the transport to attach.
      connection,
      isConnecting:
        phase === "connecting" ||
        phase === "reauthenticating" ||
        transportState === "connecting" ||
        transportState === "reconnecting",
      isAutoResuming: false,
      error: null,
      autoResumeError: null,
      currentHostId: profileId,
      currentRelayUsername: null,
      currentRelayUrl: null,
      currentDirectUrl: null,
      setCurrentHostId: () => {},
      isIntentionalDisconnect: false,
      connect: async () => {
        throw new Error("Sign in through the native host picker");
      },
      connectViaRelay: async () => {
        throw new Error("Sign in through the native host picker");
      },
      disconnect: switchHost,
      clearAutoResumeError: () => {},
      retryAutoResume: () => {
        void connect();
      },
      storedUrl: null,
      storedUsername: initialCredential.label,
      hasStoredSession: true,
      resumeSession: async () => {
        await reauthenticate();
      },
    }),
    [
      connect,
      connection,
      initialCredential.label,
      nativeSource,
      phase,
      profileId,
      reauthenticate,
      switchHost,
      transportState,
    ],
  );
  return (
    <RemoteConnectionContext.Provider value={value}>
      {children}
    </RemoteConnectionContext.Provider>
  );
}

// Each failure is already visible as connection state (unavailable, offline,
// or still on the native host picker), so the detail is a development aid.
function debugLogNativeCredential(message: string, error: unknown): void {
  if (import.meta.env.DEV)
    console.debug(`[NativeCredential] ${message}:`, error);
}

/** The transport as a Connection, so the route gates can mount immediately. */
function transportConnection(transport: SecureSourceTransport): Connection {
  return {
    mode: "secure",
    fetch: (path, init) => transport.fetch(path, init),
    fetchResponse: (path, init) => transport.fetchResponse(path, init),
    fetchBlob: (path) => transport.fetchBlob(path),
    fetchStream: (path, init) => transport.fetchStream(path, init),
    subscribeSession: (sessionId, handlers, lastEventId, options) =>
      transport.subscribeSession(sessionId, handlers, lastEventId, options),
    subscribeActivity: (handlers) => transport.subscribeActivity(handlers),
    subscribeGlossary: (projectId, handlers) =>
      transport.subscribeGlossary(projectId, handlers),
    subscribeWorktree: (projectId, coverage, handlers) =>
      transport.subscribeWorktree(projectId, coverage, handlers),
    subscribeSessionWatch: (sessionId, handlers, options) =>
      transport.subscribeSessionWatch(sessionId, handlers, options),
    upload: (projectId, sessionId, file, options) =>
      transport.upload(projectId, sessionId, file, options),
    uploadStagedAttachment: (file, options) =>
      transport.uploadStagedAttachment(file, options),
    forceReconnect: () => transport.reconnect(),
  };
}
