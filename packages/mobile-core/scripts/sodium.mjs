import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function source(build) {
  await mkdir(join(build, "sodium-source"), { recursive: true });
  const archive = join(join(build, "sodium-source"), "LATEST.tar.gz");
  const url =
    "https://download.libsodium.org/libsodium/releases/libsodium-1.0.22-stable.tar.gz";
  for (const [path, address] of [
    [archive, url],
    [`${archive}.minisig`, `${url}.minisig`],
  ]) {
    try {
      await stat(path);
    } catch {
      const response = await fetch(address, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(`Sodium source download: ${response.status}`);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
    }
  }
  const hash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (
    hash !== "25c47d0cbf804bf28f3a1166dc145ee013e31a8dc78bb0c9d74273fb44260567"
  ) {
    throw new Error(
      "Pinned libsodium source hash mismatch; review before changing the pin",
    );
  }
  // libsodium-sys-stable additionally verifies the upstream minisign signature.
  console.log("Pinned libsodium 1.0.22-stable archive verified");
}
