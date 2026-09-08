import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ToolCallRow } from "../../src/components/blocks/ToolCallRow";
import { SessionViewerProvider } from "../../src/components/SessionManagedViewer";
import { SchemaValidationProvider } from "../../src/contexts/SchemaValidationContext";
import { SessionMetadataProvider } from "../../src/contexts/SessionMetadataContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useVersion } from "../../src/hooks/useVersion";
import { I18nProvider } from "../../src/i18n";
import "../../src/styles/index.css";

function Fixture() {
  useVersion();
  const [data, setData] = useState<{
    projectId: string;
    stdout: string;
    stderr: string;
    toolName?: string;
    command?: string;
  }>();
  useEffect(() => {
    void fetch(`/api/fixture${window.location.search}`)
      .then((response) => response.json())
      .then(setData);
  }, []);
  if (!data) return null;
  return (
    <SessionMetadataProvider
      projectId={data.projectId}
      projectPath={null}
      sessionId="commentary-fixture"
    >
      <SessionViewerProvider sessionId="commentary-fixture">
        <main style={{ maxWidth: 740, margin: "24px auto", padding: "0 24px" }}>
          <div className="assistant-turn">
            <ToolCallRow
              id="report"
              toolName={data.toolName ?? "Bash"}
              toolInput={
                data.toolName === "Exec"
                  ? {
                      calls: [
                        {
                          toolName: "exec_command",
                          input: {
                            cmd: "pnpm -s artifact:capture index.html --json",
                          },
                        },
                      ],
                      source:
                        "text(await tools.exec_command({cmd: 'pnpm -s artifact:capture index.html --json'}))",
                    }
                  : { command: data.command ?? "report --jsonl" }
              }
              status="complete"
              toolResult={{
                content: data.stdout,
                isError: false,
                structured:
                  data.toolName === "Exec"
                    ? undefined
                    : { ...data, interrupted: false, isImage: false },
              }}
            />
          </div>
        </main>
      </SessionViewerProvider>
    </SessionMetadataProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <MemoryRouter>
      <ToastProvider>
        <SchemaValidationProvider>
          <Fixture />
        </SchemaValidationProvider>
      </ToastProvider>
    </MemoryRouter>
  </I18nProvider>,
);
