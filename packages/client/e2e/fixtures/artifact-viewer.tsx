import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ArtifactPreview } from "../../src/components/ArtifactPreview";
import { ResourceContextMenu } from "../../src/components/FileResourceActions";
import { ArtifactSettings } from "../../src/pages/settings/ArtifactSettings";
import { useVersion } from "../../src/hooks/useVersion";
import { I18nProvider } from "../../src/i18n";
import { LocalFileModal } from "../../src/components/LocalMediaModal";
import "../../src/styles/index.css";

function Fixture() {
  useVersion();
  const query = new URLSearchParams(location.search);
  const [updates, setUpdates] = useState(0);
  const [openedPath, setOpenedPath] = useState("");
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("editor")) return;
    const timer = window.setInterval(
      () => setUpdates((value) => value + 1),
      25,
    );
    return () => window.clearInterval(timer);
  }, []);
  if (query.has("editor"))
    return (
      <div data-testid="background-updates" data-updates={updates}>
        <LocalFileModal
          resource={{ kind: "local-file", path: query.get("path") ?? "" }}
          onClose={() => {}}
        />
      </div>
    );
  if (query.has("links"))
    return (
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <output data-testid="opened-path">{openedPath}</output>
        <ArtifactPreview
          html='<p><a href="paper.pdf">Paper PDF</a> <a href="https://example.invalid/">Elsewhere</a></p>'
          path={query.get("path") ?? ""}
          documentPath={query.get("path")}
          title="Linked notes"
          onLocalResourceLink={(resource) => setOpenedPath(resource.path)}
        />
      </div>
    );
  return query.has("menu") ? (
    <ResourceContextMenu
      x={20}
      y={20}
      canStartNewSession={false}
      onClose={() => {}}
      onCopyPublicUrl={() => {}}
      download={{ url: "about:blank" }}
      onOpen={() => {}}
    />
  ) : query.has("settings") ? (
    <div style={{ padding: 20, maxWidth: 700 }}>
      <ArtifactSettings />
    </div>
  ) : (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <ArtifactPreview
        html="<h1>Static preview</h1>"
        path={query.get("path") ?? ""}
        title="Field notes"
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <Fixture />
  </I18nProvider>,
);
