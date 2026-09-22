import { describe, expect, it } from "vitest";
import {
  artifactTargetPath,
  createArtifactEditDocument,
  parseArtifactSourceTargets,
} from "./artifactSourceTargets";

describe("artifact source targets", () => {
  const html = `<!--# sourceMappingURL=maps/paper.html.map -->
<!-- ya-source-target:v1 {"id":"paragraph","source":"../../sections/intro.qmd","sourceRange":[[4,0],[7,0]]} -->
<p>Same words. <em>Different word</em></p>
<!-- /ya-source-target:v1 paragraph -->`;
  it("maps rendered paragraphs to original file ranges with sidecar-relative paths", () => {
    const result = parseArtifactSourceTargets(html);
    expect(result.targets[0]?.sourceRange[0]).toEqual([4, 0]);
    expect(
      result.document.querySelector("p")?.getAttribute("data-ya-edit-target"),
    ).toBe("paragraph");
    expect(artifactTargetPath(result.targets[0]!.source, result.mapUrl)).toBe(
      "maps/../../sections/intro.qmd",
    );
  });
  it("ignores comment-like text in scripts and rejects malformed pairs", () => {
    expect(
      parseArtifactSourceTargets(
        `<script>const s = ${JSON.stringify(html)}</script>`,
      ).targets,
    ).toEqual([]);
    expect(() =>
      parseArtifactSourceTargets(
        html.replace(
          "/ya-source-target:v1 paragraph",
          "/ya-source-target:v1 wrong",
        ),
      ),
    ).toThrow("Unmatched");
    expect(() => parseArtifactSourceTargets(html + html)).toThrow();
  });
  it("keeps ordinary HTML editable without mappings and strips active content from selection view", () => {
    const result = parseArtifactSourceTargets(
      '<p onclick="alert(1)">Plain</p><script>evil()</script><iframe src="/api"></iframe>',
    );
    expect(result.targets).toEqual([]);
    const output = createArtifactEditDocument(result.document, "testnonce");
    expect(output).not.toContain("evil()");
    expect(output).not.toContain("onclick=");
    expect(output).not.toContain("<iframe");
    expect(output).toContain("script-src 'nonce-testnonce'");
    expect(output).toContain("ya-source-target");
  });
});
