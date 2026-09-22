export interface ArtifactSourceTarget {
  id: string;
  source: string;
  sourceRange: [[number, number], [number, number]];
}

/** Read producer-authored HTML comment targets; coordinates are zero-based. */
export function parseArtifactSourceTargets(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of document.querySelectorAll("[data-ya-edit-target]"))
    element.removeAttribute("data-ya-edit-target");
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
  const nodes: Node[] = [];
  let next = walker.nextNode();
  while (next) {
    nodes.push(next);
    next = walker.nextNode();
  }
  const targets: ArtifactSourceTarget[] = [];
  const stack: Array<{
    id: string;
    target?: ArtifactSourceTarget;
  }> = [];
  const ids = new Set<string>();
  let mapUrl: string | undefined;
  for (const comment of nodes) {
    if (comment.nodeType !== Node.COMMENT_NODE) {
      const target = stack.at(-1)?.target;
      if (
        target &&
        comment instanceof Element &&
        !["HTML", "HEAD", "BODY", "SCRIPT", "STYLE"].includes(comment.tagName)
      ) {
        comment.setAttribute("data-ya-edit-target", target.id);
      } else if (
        target &&
        comment.nodeType === Node.TEXT_NODE &&
        comment.textContent?.trim() &&
        !comment.parentElement?.closest("script,style,title") &&
        comment.parentElement?.getAttribute("data-ya-edit-target") !== target.id
      ) {
        const span = document.createElement("span");
        span.setAttribute("data-ya-edit-target", target.id);
        comment.parentNode?.insertBefore(span, comment);
        span.append(comment);
      }
      continue;
    }
    const text = comment.textContent?.trim() ?? "";
    if (text.startsWith("# sourceMappingURL=")) {
      if (mapUrl !== undefined)
        throw new Error("Multiple HTML source maps are ambiguous");
      mapUrl = text.slice("# sourceMappingURL=".length).trim();
      if (!mapUrl || /^[a-z][a-z\d+.-]*:|^\/|^\\/i.test(mapUrl))
        throw new Error(
          "The HTML source map must be a relative file reference",
        );
    } else if (text.startsWith("ya-source-target:v1 ")) {
      const value: unknown = JSON.parse(
        text.slice("ya-source-target:v1 ".length),
      );
      if (
        !value ||
        typeof value !== "object" ||
        !("id" in value) ||
        typeof value.id !== "string" ||
        !value.id ||
        ids.has(value.id)
      )
        throw new Error("Invalid or duplicate HTML source target");
      ids.add(value.id);
      if (ids.size > 10000) throw new Error("Too many HTML source targets");
      const record = value as Record<string, unknown>;
      let target: ArtifactSourceTarget | undefined;
      if (record.source !== undefined) {
        const range = record.sourceRange;
        if (
          typeof record.source !== "string" ||
          !record.source ||
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every(
            (point) =>
              Array.isArray(point) &&
              point.length === 2 &&
              point.every((n) => Number.isSafeInteger(n) && n >= 0),
          )
        )
          throw new Error("Invalid HTML source target range");
        const sourceRange = range as ArtifactSourceTarget["sourceRange"];
        if (
          sourceRange[1][0] < sourceRange[0][0] ||
          (sourceRange[1][0] === sourceRange[0][0] &&
            sourceRange[1][1] < sourceRange[0][1])
        )
          throw new Error("Reversed HTML source target range");
        target = { id: value.id, source: record.source, sourceRange };
        targets.push(target);
      }
      stack.push({ id: value.id, target });
    } else if (text.startsWith("/ya-source-target:v1 ")) {
      const entry = stack.pop();
      if (
        !entry ||
        entry.id !== text.slice("/ya-source-target:v1 ".length).trim()
      )
        throw new Error("Unmatched HTML source target markers");
    }
  }
  if (stack.length) throw new Error("Unclosed HTML source target marker");
  return { document, targets, mapUrl };
}

/** Resolve source paths against the sidecar's directory without fetching URLs. */
export function artifactTargetPath(source: string, mapUrl?: string): string {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(source) ||
    source.startsWith("//") ||
    source.includes("\\")
  )
    throw new Error("Source target must be a local relative or absolute path");
  if (source.startsWith("/")) return source;
  const mapDirectory = mapUrl?.slice(0, mapUrl.lastIndexOf("/") + 1) ?? "";
  return `${mapDirectory}${source}`;
}

/** Isolated static selection view: only our nonce-authorized bridge may run. */
export function createArtifactEditDocument(
  document: Document,
  nonce: string,
  assetBase?: string,
): string {
  const copy = document.documentElement.cloneNode(true) as HTMLElement;
  for (const element of copy.querySelectorAll(
    "script, iframe, frame, object, embed, base, meta, form",
  ))
    element.remove();
  for (const element of copy.querySelectorAll("*")) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot the live attributes before removing them
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith("on") ||
        attribute.name === "nonce" ||
        attribute.name === "srcdoc"
      )
        element.removeAttribute(attribute.name);
    }
  }
  const origin = assetBase ? new URL(assetBase).origin : "";
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' ${origin}; img-src data: blob: ${origin}; font-src data: ${origin}; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri ${origin || "'none'"}`;
  const head = copy.querySelector("head")!;
  head.insertAdjacentHTML(
    "afterbegin",
    `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`,
  );
  if (assetBase) {
    const base = document.createElement("base");
    base.href = assetBase;
    head.append(base);
  }
  const style = document.createElement("style");
  style.textContent =
    "[data-ya-edit-target]{cursor:text} [data-ya-edit-target]:hover,[data-ya-edit-target]:focus{outline:2px solid #5688dd;outline-offset:3px}";
  head.append(style);
  for (const element of copy.querySelectorAll("[data-ya-edit-target]"))
    element.setAttribute("tabindex", "0");
  const script = document.createElement("script");
  script.setAttribute("nonce", nonce);
  script.textContent = `document.addEventListener('click',select,true);document.addEventListener('keydown',function(e){if(e.key==='Enter')select(e)},true);function select(e){e.preventDefault();e.stopPropagation();var target=e.target.closest('[data-ya-edit-target]');if(target)parent.postMessage({type:'ya-source-target',nonce:${JSON.stringify(nonce)},id:target.getAttribute('data-ya-edit-target')},'*')}`;
  copy.querySelector("body")!.append(script);
  return `<!doctype html>${copy.outerHTML}`;
}
