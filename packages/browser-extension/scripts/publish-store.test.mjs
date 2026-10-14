import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCandidate, publishStore } from "./publish-store.mjs";

const identity = JSON.parse(
  await readFile(
    new URL(
      "../../../docs/distribution/chrome-extension/identity.json",
      import.meta.url,
    ),
  ),
);
const publisherId = "test-publisher";
const name = `publishers/${publisherId}/items/${identity.id}`;
const revision = "a".repeat(40);
const build = {
  version: "0.1.4",
  extensionId: identity.id,
  revision,
  sourceDirty: false,
  filename: "yep-anywhere-chrome-0.1.4.zip",
};
const zip = Buffer.from("accepted artifact bytes");
build.sha256 = createHash("sha256").update(zip).digest("hex");
const candidate = { build, zip };
const publishedItemRevisionStatus = {
  state: "PUBLISHED",
  distributionChannels: [{ crxVersion: "0.1.3" }],
};
const status = {
  name,
  itemId: identity.id,
  publicKey: identity.key,
  publishedItemRevisionStatus,
};

function sequence(responses) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, ...options });
      assert(responses.length, "Unexpected extra API call");
      const response = responses.shift();
      return new Response(
        JSON.stringify({ name, itemId: identity.id, ...response }),
        { status: 200 },
      );
    },
  };
}

test("asynchronous upload submits the accepted bytes only after processing succeeds", async () => {
  const { calls, request } = sequence([
    status,
    { uploadState: "IN_PROGRESS" },
    { ...status, lastAsyncUploadState: "IN_PROGRESS" },
    { ...status, lastAsyncUploadState: "SUCCEEDED" },
    { state: "PENDING_REVIEW" },
  ]);
  const receipt = await publishStore({
    token: "test-token",
    publisherId,
    candidate,
    request,
    pause: async () => {},
  });
  assert.equal(receipt.state, "PENDING_REVIEW");
  assert.deepEqual(
    calls.map((call) => [call.method, call.url.split(":").at(-1)]),
    [
      ["GET", "fetchStatus"],
      ["POST", "upload"],
      ["GET", "fetchStatus"],
      ["GET", "fetchStatus"],
      ["POST", "publish"],
    ],
  );
  assert.equal(calls[1].body, zip);
  assert.match(calls[1].url, /\/upload\/v2\//);
  assert.deepEqual(JSON.parse(calls.at(-1).body), {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
    blockOnWarnings: true,
  });
});

test("a rerun recognizes the submitted version and never changes another active submission", async () => {
  for (const version of ["0.1.4", "0.1.5"]) {
    const { request, calls } = sequence([
      {
        ...status,
        submittedItemRevisionStatus: {
          state: "PENDING_REVIEW",
          distributionChannels: [{ crxVersion: version }],
        },
      },
    ]);
    const operation = publishStore({
      token: "test-token",
      publisherId,
      candidate,
      request,
    });
    if (version === build.version)
      assert.equal((await operation).status, "already-submitted");
    else await assert.rejects(operation, /Another version/);
    assert.equal(calls.length, 1);
  }
});

test("status verification is read-only and refuses a different public key", async () => {
  const pem = `-----BEGIN PUBLIC KEY-----\n${identity.key.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----\n`;
  const { calls, request } = sequence([{ ...status, publicKey: pem }]);
  assert.equal(
    (
      await publishStore({
        token: "test-token",
        publisherId,
        request,
        checkOnly: true,
      })
    ).status,
    "authenticated",
  );
  assert.equal(calls.length, 1);
  const other = sequence([{ ...status, publicKey: "another-key" }]);
  await assert.rejects(
    publishStore({
      token: "test-token",
      publisherId,
      request: other.request,
      checkOnly: true,
    }),
    /public key/,
  );
});

test("failed processing never submits, and HTTP errors do not expose response credentials", async () => {
  const failed = sequence([status, { uploadState: "FAILED" }]);
  await assert.rejects(
    publishStore({
      token: "test-token",
      publisherId,
      candidate,
      request: failed.request,
    }),
    /Upload failed/,
  );
  assert.equal(failed.calls.length, 2);
  await assert.rejects(
    publishStore({
      token: "test-token",
      publisherId,
      checkOnly: true,
      request: async () =>
        new Response("secret-response-content", { status: 403 }),
    }),
    (error) =>
      error.message.includes("HTTP 403") &&
      !error.message.includes("secret-response-content"),
  );
});

test("release artifacts must match the clean source and checksum before a network write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ya-cws-candidate-"));
  try {
    await writeFile(join(directory, "build.json"), JSON.stringify(build));
    await writeFile(join(directory, build.filename), zip);
    assert.deepEqual((await loadCandidate(directory, revision)).build, build);
    await assert.rejects(
      loadCandidate(directory, "b".repeat(40)),
      /source differs/,
    );
    await writeFile(
      join(directory, "build.json"),
      JSON.stringify({ ...build, sourceDirty: true }),
    );
    await assert.rejects(loadCandidate(directory, revision), /dirty source/);
    await writeFile(join(directory, "build.json"), JSON.stringify(build));
    await writeFile(join(directory, build.filename), "changed bytes");
    await assert.rejects(loadCandidate(directory, revision), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
