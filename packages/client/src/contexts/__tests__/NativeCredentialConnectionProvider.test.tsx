// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRelayClientSocket } from "../../lib/connection/RelayClientSocket";
import {
  ScriptedResumeSocket,
  resumeSession,
} from "../../lib/connection/__tests__/ScriptedResumeSocket";
import type { NativeSessionCredential } from "../../lib/nativeHost";
import {
  getSourceRuntimeRegistry,
  resetSourceRuntimeRegistryForTests,
} from "../../lib/sourceRuntime";
import { ClientSummarySourceBinding } from "../ClientSummarySourceBinding";
import { NativeCredentialConnectionProvider } from "../NativeCredentialConnectionProvider";
import { useRemoteConnection } from "../RemoteConnectionContext";

// Fake only the native host and the relay socket acquisition; the provider,
// SecureConnection resume/proof/encryption, transport and registry are real.
const native = vi.hoisted(() => ({
  credential: vi.fn(),
  reauthenticate: vi.fn(),
  switchHost: vi.fn(),
}));
vi.mock("../../lib/nativeHost", () => ({
  nativeHost: {
    session: {
      supported: async () => true,
      credential: native.credential,
      reauthenticate: native.reauthenticate,
    },
    host: { switch: native.switchHost },
  },
}));
vi.mock("../../lib/connection/RelayClientSocket", () => ({
  openRelayClientSocket: vi.fn(),
}));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const credential: NativeSessionCredential = {
  profileId: "profile-1",
  label: "test-host",
  username: resumeSession.username,
  sessionId: resumeSession.sessionId,
  sessionKey: resumeSession.sessionKey,
  resumeProtocolVersion: 3,
  routes: [
    {
      kind: "relay",
      wsUrl: "wss://relay.example/ws",
      relayUsername: "test-host",
    },
  ],
};

let sockets: ScriptedResumeSocket[];
let socketModes: ScriptedResumeSocket["mode"][];

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

function Page() {
  const remote = useRemoteConnection();
  const [draft, setDraft] = useState("unsent");
  const [status, setStatus] = useState("idle");
  return (
    <>
      <output data-testid="mounted">{remote.connection ? "yes" : "no"}</output>
      <output data-testid="connecting">
        {remote.isConnecting ? "connecting" : "settled"}
      </output>
      <textarea
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          void getSourceRuntimeRegistry()
            .getCurrentSourceRuntime()
            .transport.fetch<{ authenticated: boolean }>("/auth/status")
            .then(
              (body) => setStatus(String(body.authenticated)),
              (error: Error) => setStatus(`error: ${error.message}`),
            );
        }}
      >
        Probe
      </button>
      <output data-testid="probe">{status}</output>
    </>
  );
}

function App() {
  return (
    <MemoryRouter initialEntries={["/projects"]}>
      <NativeCredentialConnectionProvider>
        <ClientSummarySourceBinding />
        <Page />
      </NativeCredentialConnectionProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // Node's TextEncoder returns a different realm's Uint8Array under jsdom.
  const Encoder = TextEncoder;
  vi.stubGlobal(
    "TextEncoder",
    class extends Encoder {
      encode(text?: string) {
        return Uint8Array.from(super.encode(text));
      }
    },
  );
  localStorage.clear();
  sessionStorage.clear();
  sockets = [];
  socketModes = [];
  native.credential.mockReset().mockResolvedValue(credential);
  native.reauthenticate.mockReset();
  native.switchHost.mockReset().mockResolvedValue(undefined);
  vi.mocked(openRelayClientSocket).mockReset();
  vi.mocked(openRelayClientSocket).mockImplementation(async () => {
    const socket = new ScriptedResumeSocket();
    socket.mode = socketModes.shift() ?? "ok";
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
});

afterEach(() => {
  cleanup();
  resetSourceRuntimeRegistryForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NativeCredentialConnectionProvider", () => {
  it("mounts before resume completes and never stores the credential", async () => {
    socketModes = ["silent-proof"];
    render(<App />);
    await flush();

    // The page is usable while the first resume is still in flight.
    expect(screen.getByTestId("mounted").textContent).toBe("yes");
    expect(screen.getByTestId("connecting").textContent).toBe("connecting");
    expect((screen.getByLabelText("Draft") as HTMLTextAreaElement).value).toBe(
      "unsent",
    );
    expect(native.reauthenticate).not.toHaveBeenCalled();

    cleanup();
    resetSourceRuntimeRegistryForTests();
    socketModes = ["ok"];
    render(<App />);
    await flush();
    act(() => screen.getByRole("button", { name: "Probe" }).click());
    await flush();

    expect(screen.getByTestId("probe").textContent).toBe("true");
    expect(screen.getByTestId("connecting").textContent).toBe("settled");
    expect(vi.mocked(openRelayClientSocket)).toHaveBeenLastCalledWith({
      relayUrl: "wss://relay.example/ws",
      relayUsername: "test-host",
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("asks native to sign in again when the server rejects the session", async () => {
    socketModes = ["rejected", "ok"];
    native.reauthenticate.mockResolvedValue({
      ...credential,
      sessionId: "replacement-session",
    });
    render(<App />);
    await flush();
    await flush();

    expect(native.reauthenticate).toHaveBeenCalledTimes(1);
    expect(native.reauthenticate).toHaveBeenCalledWith(resumeSession.sessionId);
    expect(sockets).toHaveLength(2);
    act(() => screen.getByRole("button", { name: "Probe" }).click());
    await flush();
    expect(screen.getByTestId("probe").textContent).toBe("true");
    expect(localStorage.length).toBe(0);
  });

  it("waits for recovery when native still accepts the rejected session", async () => {
    socketModes = ["rejected", "ok"];
    native.reauthenticate.mockResolvedValue({ ...credential });
    render(<App />);
    await flush();
    await flush();

    // No immediate retry loop with the same session; the page stays mounted.
    expect(native.reauthenticate).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expect(screen.getByTestId("mounted").textContent).toBe("yes");
    expect(screen.getByTestId("connecting").textContent).toBe("settled");
  });

  it("falls through an unreachable route to the next one without signing in", async () => {
    native.credential.mockResolvedValue({
      ...credential,
      routes: [
        {
          kind: "relay",
          wsUrl: "wss://unreachable.example/ws",
          relayUsername: "test-host",
        },
        ...credential.routes,
      ],
    });
    vi.mocked(openRelayClientSocket).mockImplementationOnce(async () => {
      throw new Error("Failed to connect to relay server");
    });
    render(<App />);
    await flush();
    act(() => screen.getByRole("button", { name: "Probe" }).click());
    await flush();

    expect(
      vi
        .mocked(openRelayClientSocket)
        .mock.calls.map(([call]) => call.relayUrl),
    ).toEqual(["wss://unreachable.example/ws", "wss://relay.example/ws"]);
    expect(screen.getByTestId("probe").textContent).toBe("true");
    expect(native.reauthenticate).not.toHaveBeenCalled();
  });

  it("stays mounted offline when no route is reachable", async () => {
    vi.mocked(openRelayClientSocket).mockImplementation(async () => {
      throw new Error("Failed to connect to relay server");
    });
    render(<App />);
    await flush();

    expect(screen.getByTestId("mounted").textContent).toBe("yes");
    expect(screen.getByTestId("connecting").textContent).toBe("settled");
    expect(native.reauthenticate).not.toHaveBeenCalled();
  });
});
