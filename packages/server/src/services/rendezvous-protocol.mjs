import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The shared `.rendez` filesystem protocol (graehl/agents
 * topics/rendezvous.md), as far as the provider-runtime script also needs it.
 * Plain JavaScript because that script imports it without a build. Every
 * coordination point is an atomic file operation; nothing locks.
 */

export const MAX_ROUTES = 128;
const LATEST_PASSES = 8;
const ROUTE_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const RESERVED_ROUTES = new Set(["latest-session", "delivered", "routes"]);

export function routeName(value) {
  if (!ROUTE_PATTERN.test(value)) {
    throw new Error(
      "Rendezvous route must contain only letters, digits, underscores, or hyphens",
    );
  }
  if (RESERVED_ROUTES.has(value)) {
    throw new Error("Rendezvous route name is reserved");
  }
  return value;
}

/** Replace a JSON file so readers see either the old or the new record. */
export async function atomicJson(path, value) {
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`);
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, path);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function ensureDirectory(path, description) {
  try {
    await fs.mkdir(path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if ((await fs.lstat(path)).isSymbolicLink()) {
    throw new Error(`Rendezvous ${description} must not be a symlink`);
  }
}

/**
 * Subscribe a target to its route inside an existing `.rendez` root, and
 * optionally record a user turn for `latest-session`.
 */
export async function subscribe(
  root,
  target,
  { route, latest = false, receivedAt = Date.now() } = {},
) {
  const name = routeName(
    route ?? target.yaSessionId ?? target.providerSessionId,
  );
  if (!target.harness || !target.providerSessionId) {
    throw new Error("Rendezvous subscriptions require a harness and session");
  }
  await ensureDirectory(join(root, "routes"), "routes");
  await ensureDirectory(join(root, "delivered"), "delivered");
  const directory = join(root, "routes", name);
  await ensureDirectory(directory, "route");
  await ensureDirectory(join(directory, "inbox"), "inbox");
  const record = {
    version: 1,
    route: name,
    project: dirname(root),
    target,
  };
  const existing = join(directory, "subscription.json");
  try {
    const previous = JSON.parse(await fs.readFile(existing, "utf8")).target;
    if (
      ["harness", "providerSessionId", "yaSessionId"].some(
        (key) => previous[key] !== target[key],
      )
    ) {
      throw new Error("Rendezvous route already belongs to another target");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await atomicJson(existing, record);
  const inbox = join("routes", name, "inbox");
  try {
    await fs.symlink(inbox, join(root, name), "dir");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const alias = join(root, name);
    if (!(await fs.lstat(alias)).isSymbolicLink()) {
      throw new Error("Rendezvous named destination already exists");
    }
    if ((await fs.readlink(alias)) !== inbox) {
      throw new Error(
        "Rendezvous named destination points to another directory",
      );
    }
  }
  if (latest) await publishLatest(root, name, receivedAt);
  return { ...record, path: join(directory, "inbox") };
}

/**
 * Point `latest-session` at the route with the newest recorded user turn.
 * Each writer records its turn as an entry, moves the pointer to the newest
 * entry, and repeats until a listing shows no newer arrival, so the last
 * writer to look leaves the pointer correct. Fixed-width names sort by time,
 * then route, identically for every writer.
 */
export async function publishLatest(root, route, receivedAt) {
  const entries = join(root, "latest.d");
  await ensureDirectory(entries, "latest.d");
  await (
    await fs.open(
      join(entries, `${String(receivedAt).padStart(16, "0")}-${route}`),
      "a",
    )
  ).close();
  const link = join(root, "latest-session");
  let newest;
  for (let pass = 0; pass < LATEST_PASSES; pass++) {
    const names = (await fs.readdir(entries))
      .filter((name) => !name.startsWith("."))
      .sort();
    const candidate = names.at(-1);
    if (candidate === newest) {
      for (const name of names.slice(0, -1)) {
        await fs.rm(join(entries, name), { force: true });
      }
      return;
    }
    newest = candidate;
    const want = join("routes", newest.slice(17), "inbox");
    let current;
    try {
      current = await fs.readlink(link);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EINVAL") throw error;
    }
    if (current !== want) {
      const temporary = join(root, `.latest-${randomUUID()}`);
      await fs.symlink(want, temporary, "dir");
      await fs.rename(temporary, link);
    }
  }
  throw new Error("Rendezvous latest-session kept changing; retry the turn");
}
