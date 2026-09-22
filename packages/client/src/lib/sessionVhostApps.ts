import type {
  ArtifactViewerStatus,
  AppContentBlock,
} from "@yep-anywhere/shared";
import type { Message } from "../types";
import { artifactAudience, isArtifactLink } from "./artifactPreview";
export type SessionAppConfig = ArtifactViewerStatus & {
  accessTokens?: Record<string, string | null>;
};

export interface SessionVhostApp {
  sourceUrl: string;
  url: string;
  label: string;
  artifactToken?: string;
}

export interface SessionVhostLinkContext {
  clientUrl: string;
  relayed: boolean;
  force?: boolean;
}

const toolUrls = new WeakMap<Message, string[]>();

/** Discover local app URLs only in tool result text, without rescanning immutable history. */
export function sessionToolUrls(message: Message): string[] {
  const cached = toolUrls.get(message);
  if (cached) return cached;
  const urls: string[] = [];
  const content = message.message?.content ?? message.content;
  function readResult(value: string | AppContentBlock[] | undefined) {
    if (typeof value === "string") {
      for (const match of value.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
        const raw = match[0].replace(/[),.;]+$/, "");
        if (/\$\{|\$%7b/i.test(raw)) continue;
        try {
          const url = new URL(raw);
          if (
            artifactAudience(url.hostname) === "local" ||
            url.pathname.startsWith("/a/")
          )
            urls.push(raw);
        } catch {
          // A URL-looking fragment in tool text need not be a valid URL.
        }
      }
    } else if (Array.isArray(value)) {
      for (const block of value) {
        if (block.type === "text") readResult(block.text);
      }
    }
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_result") readResult(block.content);
    }
  }
  toolUrls.set(message, urls);
  return urls;
}

/** Rewrite a loopback tool URL through the operator's static vhost table. */
export function sessionVhostApp(
  raw: string,
  config: SessionAppConfig | undefined,
  clientUrl: string,
  audience?: "local" | "public",
): SessionVhostApp | undefined {
  // Source templates are not running-app announcements, including saved links.
  if (/\$\{|\$%7b/i.test(raw)) return;
  if (isArtifactLink(raw, config, clientUrl)) {
    const url = new URL(raw);
    return {
      sourceUrl: raw,
      url: url.href,
      label: url.pathname.split("/").at(-1)!,
      artifactToken: url.pathname.split("/")[2],
    };
  }
  if (!config?.vhosts?.length) return;
  let source: URL;
  try {
    source = new URL(raw);
  } catch {
    return;
  }
  if (
    source.protocol !== "http:" ||
    artifactAudience(source.hostname) !== "local" ||
    source.username ||
    source.password
  )
    return;
  const row = config.vhosts.find(
    (row) => row.port === Number(source.port || 80),
  );
  if (!row) return;
  const client = new URL(clientUrl);
  let target: URL;
  if ((audience ?? artifactAudience(client.hostname)) === "local") {
    if (!config.localOrigin) return;
    target = new URL(config.localOrigin);
    target.hostname = `${row.name}.localhost`;
  } else {
    if (!config.vhostPublicRoot) return;
    target = new URL(`https://${row.name}.${config.vhostPublicRoot}`);
  }
  if (
    target.hostname === client.hostname ||
    (client.protocol === "https:" && target.protocol !== "https:")
  )
    return;
  target.pathname = source.pathname;
  target.search = source.search;
  const token = config.accessTokens?.[row.name];
  if (config.accessTokens && token === undefined) return;
  if (token) target.searchParams.set("ya_access", token);
  target.hash = source.hash;
  return {
    sourceUrl: raw,
    url: target.href,
    label: `${row.name}${source.pathname === "/" ? "" : source.pathname}`,
  };
}

/** Rewrite a name.localhost URL through the configured public wildcard root. */
export function rewriteSessionLocalhostHref(
  raw: string,
  config: SessionAppConfig | undefined,
  context: SessionVhostLinkContext,
): string {
  if (!config?.vhostPublicRoot) return raw;
  let source: URL;
  let client: URL;
  try {
    client = new URL(context.clientUrl);
    source = new URL(raw, client);
  } catch {
    return raw;
  }
  const automatic =
    context.relayed && artifactAudience(client.hostname) === "public";
  if (!automatic && !config.alwaysRewriteVhostLinks && !context.force)
    return raw;
  if (
    !["http:", "https:"].includes(source.protocol) ||
    source.username ||
    source.password ||
    !source.hostname.endsWith(".localhost")
  )
    return raw;
  const name = source.hostname.slice(0, -".localhost".length);
  if (!name) return raw;
  const configuredVhost = config.vhosts?.some((row) => row.name === name);
  const token = configuredVhost ? config.accessTokens?.[name] : undefined;
  if (configuredVhost && config.accessTokens && token === undefined) return raw;
  const target = new URL(`https://${name}.${config.vhostPublicRoot}`);
  target.pathname = source.pathname;
  target.search = source.search;
  if (token) target.searchParams.set("ya_access", token);
  target.hash = source.hash;
  return target.href;
}
