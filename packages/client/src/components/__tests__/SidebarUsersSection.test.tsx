// @vitest-environment jsdom

import type { ActingPrincipal } from "@yep-anywhere/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarUsersSection } from "../SidebarUsersSection";

/** topics/limited-users.md § Delivery v1 — Users section in the sidebar. */

vi.mock("../../hooks/useProjects", () => ({
  useProjects: () => ({ projects: [] }),
}));
vi.mock("../../hooks/useProviders", () => ({
  useProviders: () => ({ providers: [] }),
}));
vi.mock("../../api/client", () => ({
  api: {
    listUsers: vi.fn().mockResolvedValue({ users: [], enabled: true }),
    switchUser: vi.fn(),
    logoutUser: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
}));
vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const SUPERUSER: ActingPrincipal = {
  superuser: true,
  username: null,
  switched: false,
  locked: false,
  enabled: false,
  logoutRedirect: "stay",
};

afterEach(cleanup);

describe("SidebarUsersSection", () => {
  it("shows nothing while the feature is off and nobody is switched", () => {
    const { container } = render(
      <SidebarUsersSection
        principal={SUPERUSER}
        onPrincipalChanged={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("captions the acting username and offers logout to a limited user", () => {
    render(
      <SidebarUsersSection
        principal={{
          superuser: false,
          username: "alice",
          switched: false,
          locked: true,
          enabled: true,
          logoutRedirect: "relay-login",
          grants: {
            newSessionProjects: ["p1"],
            joinProjects: [],
            viewProjects: ["p2"],
            joinStaleOffsetMinutes: 0,
            lock: { provider: "codex" },
          },
        }}
        onPrincipalChanged={() => {}}
      />,
    );
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("usersLogout")).toBeTruthy();
    // A limited user sees their settings but is offered no way to edit them.
    expect(screen.queryByText("usersManageOpen")).toBeNull();
  });

  it("offers a switched superuser the way back", () => {
    render(
      <SidebarUsersSection
        principal={{
          superuser: true,
          username: "alice",
          switched: true,
          locked: false,
          enabled: true,
          logoutRedirect: "stay",
        }}
        onPrincipalChanged={() => {}}
      />,
    );
    expect(screen.getByText("usersReturnToSuperuser")).toBeTruthy();
    // User administration is refused while switched, so it is not offered.
    expect(screen.queryByText("usersManageOpen")).toBeNull();
  });

  it("shows initials only in the collapsed rail", () => {
    render(
      <SidebarUsersSection
        isCollapsed
        principal={{
          superuser: true,
          username: "alice",
          switched: true,
          locked: false,
          enabled: true,
          logoutRedirect: "stay",
        }}
        onPrincipalChanged={() => {}}
      />,
    );
    expect(screen.getByText("al")).toBeTruthy();
    expect(screen.queryByText("usersLogout")).toBeNull();
  });
});
