import { decodeCodeModeOutput, initialAcliFormat } from "@yep-anywhere/shared";
import { normalizeBashResult } from "../components/renderers/tools/BashRenderer";
import type { BashResult } from "../components/renderers/tools/types";
import type { ToolCallItem } from "../types/renderItems";

type Invocation = Pick<ToolCallItem, "toolName" | "toolInput" | "toolResult">;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readToolCommentaryOutput(props: Invocation) {
  const raw =
    props.toolResult?.structured ??
    props.toolResult?.content ??
    record(props.toolInput)?._previewResult;
  if (
    ["bash", "exec_command", "shell_command"].includes(
      props.toolName.toLowerCase(),
    )
  ) {
    const shell = normalizeBashResult(
      raw as BashResult | string | undefined,
      props.toolResult?.isError ?? false,
    );
    return {
      stdout: shell.stdout ?? "",
      stderr: shell.stderr ?? "",
      shell,
      stdoutSequenced: typeof record(raw)?.stdout === "string",
    };
  }
  const structured = record(raw);
  return {
    stdout:
      typeof structured?.stdout === "string"
        ? structured.stdout
        : (props.toolResult?.content ?? ""),
    stderr: typeof structured?.stderr === "string" ? structured.stderr : "",
    stdoutSequenced: typeof structured?.stdout === "string",
    shell: null,
  };
}

const completedDeclarations = new WeakMap<ToolCallItem, boolean>();

/** Declared human-facing output must survive routine-activity folding. */
export function toolDeclaresCommentary(item: ToolCallItem): boolean {
  const cached = completedDeclarations.get(item);
  if (cached !== undefined) return cached;
  const declared = declaresCommentary(item);
  if (item.status !== "pending") completedDeclarations.set(item, declared);
  return declared;
}

function declaresCommentary(item: ToolCallItem): boolean {
  const complete = item.status !== "pending";
  if (item.toolName === "Exec") {
    const output = decodeCodeModeOutput(
      item.toolResult?.structured ?? item.toolResult?.content,
    );
    return (
      output?.parts.some(
        (part) => initialAcliFormat(part.text, complete) !== null,
      ) ?? false
    );
  }
  const output = readToolCommentaryOutput(item);
  return [output.stdout, output.stderr].some(
    (text) => initialAcliFormat(text, complete) !== null,
  );
}
