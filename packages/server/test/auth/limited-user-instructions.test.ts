import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_LIMITED_USER_INSTRUCTION } from "@yep-anywhere/shared";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";
import { limitedUserInstructionsForLaunch } from "../../src/auth/limitedUserInstructions.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { createSettingsRoutes } from "../../src/routes/settings.js";

let directory: string;
let users: LimitedUsersService;
let settings: ServerSettingsService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ya-instructions-"));
  users = new LimitedUsersService({ dataDir: directory });
  settings = new ServerSettingsService({ dataDir: directory });
  await users.initialize();
  await settings.initialize();
  await users.create({ username: "alice", password: "password123" });
});
afterEach(async () => {
  await users.flushPendingWrites();
  await rm(directory, { recursive: true });
});

it("uses the editable safety default and persists ordered shared and per-user blocks", async () => {
  expect(limitedUserInstructionsForLaunch("alice", users, settings)).toEqual({
    startFromDefault: true,
    text: DEFAULT_LIMITED_USER_INSTRUCTION,
  });
  const routes = createSettingsRoutes({ serverSettingsService: settings });
  const response = await routes.request("/", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limitedUserInstructions: {
        startFromDefault: false,
        blocks: ["Shared first.", "Shared second."],
      },
    }),
  });
  expect(response.status).toBe(200);
  await users.update("alice", { instructionBlocks: ["User last."] });
  const reloadedUsers = new LimitedUsersService({ dataDir: directory });
  const reloadedSettings = new ServerSettingsService({ dataDir: directory });
  await reloadedUsers.initialize();
  await reloadedSettings.initialize();
  expect(
    limitedUserInstructionsForLaunch("alice", reloadedUsers, reloadedSettings),
  ).toEqual({
    startFromDefault: false,
    text: "Shared first.\n\nShared second.\n\nUser last.",
  });
  expect(reloadedUsers.list()[0]?.instructionBlocks).toEqual(["User last."]);
  await reloadedUsers.flushPendingWrites();
});

it("rejects malformed and oversized updates without changing the saved policy", async () => {
  const routes = createSettingsRoutes({ serverSettingsService: settings });
  for (const blocks of [
    null,
    [42],
    Array(33).fill("x"),
    ["x".repeat(10_001)],
  ]) {
    const response = await routes.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limitedUserInstructions: { startFromDefault: true, blocks },
      }),
    });
    expect(response.status).toBe(400);
  }
  await expect(
    users.update("alice", {
      instructionBlocks: ["x".repeat(10_001)],
      disabled: true,
    }),
  ).rejects.toThrow("10000");
  expect(users.get("alice")?.disabled).not.toBe(true);
  expect(limitedUserInstructionsForLaunch("alice", users, settings).text).toBe(
    DEFAULT_LIMITED_USER_INSTRUCTION,
  );
});

it("keeps two users separate and honors an intentionally empty replacement", async () => {
  await users.create({
    username: "bobby",
    password: "password123",
    instructionBlocks: ["Only Bobby."],
  });
  await settings.updateSettings({
    limitedUserInstructions: { startFromDefault: false, blocks: [] },
  });
  expect(limitedUserInstructionsForLaunch("alice", users, settings)).toEqual({
    startFromDefault: false,
    text: "",
  });
  expect(limitedUserInstructionsForLaunch("bobby", users, settings).text).toBe(
    "Only Bobby.",
  );
});
