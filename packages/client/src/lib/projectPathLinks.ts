import {
  findProjectPathTokens,
  type ProjectPathLinkTarget,
} from "@yep-anywhere/shared";
import {
  buildPublicShareFileHref,
  type PublicShareContextValue,
} from "../contexts/PublicShareContext";
import type { ProjectPathLinkSettings } from "./projectPathLinkPreferences";

export interface AnnotatedProjectPathLinksHtml {
  changed: boolean;
  html: string;
}

/**
 * Point one anchor at the file, through whichever route this viewer may use.
 *
 * Returns false when a public-share viewer cannot reach the file — outside the
 * share's project — so the caller leaves the text alone rather than minting a
 * link that only the owner could follow.
 */
function setProjectPathAnchorTarget(
  anchor: HTMLAnchorElement,
  projectId: string,
  filePath: string,
  publicShare: PublicShareContextValue | null | undefined,
): boolean {
  if (publicShare) {
    const shareHref = buildPublicShareFileHref(publicShare, { filePath });
    if (!shareHref) return false;
    anchor.setAttribute("href", shareHref);
    anchor.dataset.publicShareFileLink = "true";
  } else {
    const params = new URLSearchParams({ path: filePath });
    anchor.setAttribute(
      "href",
      `/projects/${encodeURIComponent(projectId)}/file?${params}`,
    );
    anchor.dataset.yaPrivateProjectFileLink = "true";
  }
  anchor.dataset.yaResource = "project-file";
  anchor.dataset.yaProjectId = projectId;
  anchor.dataset.yaPath = filePath;
  anchor.title = `${filePath}\nClick to view, or use a browser link gesture to open this file`;
  return true;
}

/** Link basename occurrences inside one already-sanitized HTML fragment. */
export function annotateProjectPathLinksHtml(
  html: string,
  links: readonly ProjectPathLinkTarget[] | undefined,
  projectId: string | undefined,
  publicShare?: PublicShareContextValue | null,
  settings: Pick<
    ProjectPathLinkSettings,
    "projectPaths" | "mentionedDirectories"
  > = { projectPaths: true, mentionedDirectories: true },
): AnnotatedProjectPathLinksHtml {
  if (
    !html ||
    (!links?.length &&
      settings.projectPaths &&
      !html.includes("data-ya-directory-file")) ||
    !projectId ||
    typeof document === "undefined"
  ) {
    return { changed: false, html };
  }

  const targets = new Map(links?.map((link) => [link.text, link.filePath]));
  const template = document.createElement("template");
  template.innerHTML = html;
  let changed = false;

  if (!settings.projectPaths && !publicShare) {
    for (const anchor of template.content.querySelectorAll(
      'a[data-ya-resource="project-file"], a[data-ya-resource="local-file"], a[data-fixed-font-file-path]',
    )) {
      anchor.replaceWith(...anchor.childNodes);
      changed = true;
    }
    return { changed, html: changed ? template.innerHTML : html };
  }

  const directoryAnchors = new Set<HTMLAnchorElement>();
  if (settings.mentionedDirectories && !publicShare) {
    for (const occurrence of template.content.querySelectorAll<HTMLElement>(
      "[data-ya-directory-file]",
    )) {
      const filePath = occurrence.dataset.yaDirectoryFile;
      if (!filePath) continue;
      const anchor =
        occurrence.closest<HTMLAnchorElement>("a") ??
        occurrence.querySelector<HTMLAnchorElement>("a") ??
        document.createElement("a");
      setProjectPathAnchorTarget(anchor, projectId, filePath, null);
      if (anchor.contains(occurrence)) {
        occurrence.textContent = filePath;
      } else {
        anchor.textContent = filePath;
        occurrence.replaceChildren(anchor);
      }
      const params = new URLSearchParams({ path: filePath });
      if (anchor.dataset.yaLine) params.set("line", anchor.dataset.yaLine);
      if (anchor.dataset.yaColumn)
        params.set("column", anchor.dataset.yaColumn);
      anchor.setAttribute(
        "href",
        `/projects/${encodeURIComponent(projectId)}/file?${params}`,
      );
      directoryAnchors.add(anchor);
      changed = true;
    }
  }

  // A previous full-name match is only a fallback. Do not retarget or tokenize
  // an occurrence already resolved from this turn's directory context.
  if (targets.size === 0) {
    return { changed, html: changed ? template.innerHTML : html };
  }
  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>(
    'a[data-ya-resource="project-file"]',
  )) {
    if (directoryAnchors.has(anchor)) continue;
    const filePath = targets.get(anchor.textContent?.trim() ?? "");
    if (!filePath) continue;
    if (setProjectPathAnchorTarget(anchor, projectId, filePath, publicShare)) {
      changed = true;
    }
  }

  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT,
  );
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (
      node instanceof Text &&
      !node.parentElement?.closest("a,button,script,style,textarea")
    ) {
      textNodes.push(node);
    }
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const matches = findProjectPathTokens(textNode.data).filter((token) =>
      targets.has(token.text),
    );
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      if (!match) continue;
      const anchor = document.createElement("a");
      if (
        !setProjectPathAnchorTarget(
          anchor,
          projectId,
          targets.get(match.text)!,
          publicShare,
        )
      ) {
        continue;
      }
      const suffix = textNode.splitText(match.end);
      const matched = textNode.splitText(match.start);
      matched.replaceWith(anchor);
      anchor.append(matched);
      void suffix;
      changed = true;
    }
  }

  return { changed, html: changed ? template.innerHTML : html };
}
