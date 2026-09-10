import { useState } from "react";
import { createRoot } from "react-dom/client";
import { displayProviders } from "../../src/components/renderers/tools/__fixtures__/displayProviders";
import { ToolCallRow } from "../../src/components/blocks/ToolCallRow";
import { TaskNestedContent } from "../../src/components/renderers/tools/TaskNestedContent";
import { toolDisplayDiagnostics } from "../../src/components/renderers/tools/displayDiagnostics";
import "../../src/styles/index.css";
function Fixture() {
  const [corrected, setCorrected] = useState(false);
  const [complete, setComplete] = useState(false);
  return (
    <main style={{ maxWidth: 760, margin: "20px auto", padding: "0 16px" }}>
      <h2>Tool display contracts</h2>
      <ToolCallRow
        id="valid"
        toolName="Write"
        toolInput={{
          file_path: "/tmp/contract.ts",
          content: "export const checked = true;",
          _highlightedContentHtml:
            '<pre><code><span class="line">export const checked = true;</span></code></pre>',
        }}
        toolResult={{ content: "File written", isError: false }}
        status="complete"
      />
      <section aria-label="Recoverable Write">
        <ToolCallRow
          id="recovery"
          toolName="Write"
          toolInput={
            corrected
              ? { file_path: "/tmp/recovered.ts", content: "Recovered content" }
              : { content: "validation-test" }
          }
          toolResult={{
            content: corrected
              ? "File written"
              : "InputValidationError: The required parameter file_path is missing",
            isError: !corrected,
          }}
          status={corrected ? "complete" : "error"}
        />
        <button type="button" onClick={() => setCorrected(true)}>
          Correct record
        </button>
      </section>
      <ToolCallRow
        id="partial"
        toolName="Read"
        toolInput={{ file_path: "/tmp/notes.txt" }}
        toolResult={{
          content: "Plain text remains readable without file metadata.",
          isError: false,
        }}
        status="complete"
      />
      <section aria-label="Pending call">
        <ToolCallRow
          id="pending"
          toolName="Bash"
          toolInput={{ command: "printf contract" }}
          toolResult={
            complete
              ? { content: "contract output", isError: false }
              : undefined
          }
          status={complete ? "complete" : "pending"}
        />
        <button type="button" onClick={() => setComplete(true)}>
          Complete pending call
        </button>
      </section>
      <details open>
        <summary>Subagent tools</summary>
        <TaskNestedContent
          isStreaming={false}
          messages={[
            {
              id: "child-use",
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "child-write",
                  name: "Write",
                  input: { content: "nested validation-test" },
                },
              ],
            },
            {
              id: "child-result",
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "child-write",
                  content: "Missing file_path in subagent Write",
                  is_error: true,
                },
              ],
            },
          ]}
        />
      </details>
      <output data-testid="catches">
        {toolDisplayDiagnostics.synchronousCatches +
          toolDisplayDiagnostics.renderCatches}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  displayProviders(<Fixture />),
);
