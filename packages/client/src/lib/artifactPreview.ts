import type { ArtifactViewerStatus } from "@yep-anywhere/shared";

export function artifactAudience(hostname: string): "local" | "public" {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? "local"
    : "public";
}

export function artifactOrigin(
  config: ArtifactViewerStatus,
  audience: "local" | "public",
  clientUrl: string,
): string | undefined {
  const value = audience === "local" ? config.localOrigin : config.publicOrigin;
  if (!value) return;
  const origin = new URL(value);
  const client = new URL(clientUrl);
  if (
    origin.hostname === client.hostname ||
    !["http:", "https:"].includes(origin.protocol) ||
    (client.protocol === "https:" && origin.protocol !== "https:")
  )
    return;
  return origin.origin;
}

/** No YA transport, credentials, grant token, or referrer crosses this probe. */
export async function probeArtifactOrigin(
  origin: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${origin}/health`, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok || (await response.json()).artifactViewer !== 1) {
    throw new Error("Artifact origin is unavailable");
  }
}
