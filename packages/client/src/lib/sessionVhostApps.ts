import type {
  ArtifactViewerStatus,
  AppContentBlock,
} from "@yep-anywhere/shared";
import type { Message } from "../types";
import { artifactAudience } from "./artifactPreview";

export interface SessionVhostApp {
  sourceUrl: string;
  url: string;
  label: string;
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
      for (const match of value.matchAll(
        /http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?![\w:@.-])(?:[/?#][^\s<>"'`\\]*)?/gi,
      )) {
        urls.push(match[0].replace(/[),.;]+$/, ""));
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
  config: ArtifactViewerStatus | undefined,
  clientUrl: string,
): SessionVhostApp | undefined {
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
  if (artifactAudience(client.hostname) === "local") {
    if (!config.localOrigin) return;
    target = new URL(config.localOrigin);
    target.hostname = `${row.name}.localhost`;
  } else {
    if (!config.vhostPublicRoot || !config.publicOrigin) return;
    target = new URL(`https://${row.name}.${config.vhostPublicRoot}`);
  }
  if (
    target.hostname === client.hostname ||
    (client.protocol === "https:" && target.protocol !== "https:")
  )
    return;
  target.pathname = source.pathname;
  target.search = source.search;
  target.hash = source.hash;
  return {
    sourceUrl: raw,
    url: target.href,
    label: `${row.name}${source.pathname === "/" ? "" : source.pathname}`,
  };
}
