export interface ArtifactConfig {
  port: number;
  localOrigin?: string;
  publicOrigin?: string;
}

export function validateArtifactConfig(value: unknown): ArtifactConfig {
  if (!value || typeof value !== "object")
    throw new Error("Artifact configuration must be an object");
  const input = value as Record<string, unknown>;
  if (
    typeof input.port !== "number" ||
    !Number.isInteger(input.port) ||
    input.port < 1 ||
    input.port > 65535
  )
    throw new Error("Artifact port must be from 1 to 65535");
  for (const key of ["localOrigin", "publicOrigin"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "string")
      throw new Error(`${key} must be a URL or an empty string`);
  }
  const env = {
    YEP_ARTIFACT_PORT: String(input.port),
    YEP_ARTIFACT_LOCAL_ORIGIN: input.localOrigin as string | undefined,
    YEP_ARTIFACT_PUBLIC_ORIGIN: input.publicOrigin as string | undefined,
  };
  const config = readArtifactConfig(env);
  if (!config) throw new Error("Artifact port must be from 1 to 65535");
  return config;
}

export function readArtifactConfig(
  env: NodeJS.ProcessEnv,
): ArtifactConfig | undefined {
  if (!env.YEP_ARTIFACT_PORT) return;
  // An explicit launch-time disable overrides persisted origins as well.
  if (env.YEP_ARTIFACT_PORT === "0") return { port: 4402 };
  const port = Number(env.YEP_ARTIFACT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "YEP_ARTIFACT_PORT must be an integer from 1 to 65535 (0 disables serving)",
    );
  }
  const config: ArtifactConfig = { port };
  for (const [key, name] of [
    ["localOrigin", "YEP_ARTIFACT_LOCAL_ORIGIN"],
    ["publicOrigin", "YEP_ARTIFACT_PUBLIC_ORIGIN"],
  ] as const) {
    const value = env[name];
    if (!value) continue;
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      (key === "publicOrigin" && url.protocol !== "https:")
    ) {
      throw new Error(
        `${name} must be a separate artifact origin without a path; public origins require HTTPS`,
      );
    }
    config[key] = url.origin;
  }
  return config;
}
