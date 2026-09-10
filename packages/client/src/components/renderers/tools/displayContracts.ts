import { z } from "zod";
import { canonicalizeToolName } from "../../../lib/toolNames";

// Display requirements are deliberately separate from permissive provider
// schemas: a failed or interrupted call is still a valid transcript record.
export const ReadDisplayInputSchema = z.object({
  file_path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});
export const WriteDisplayInputSchema = z.object({
  file_path: z.string(),
  content: z.string(),
});
export const TextFileDisplaySchema = z.object({
  filePath: z.string(),
  content: z.string(),
  numLines: z.number(),
  startLine: z.number(),
  totalLines: z.number(),
});
export const PatchHunkDisplaySchema = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(z.string()),
});
export const QuestionDisplaySchema = z.object({
  id: z.string().optional(),
  question: z.string(),
  header: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      description: z.string(),
      preview: z.string().optional(),
    }),
  ),
  multiSelect: z.boolean(),
  isOther: z.boolean().optional(),
  isSecret: z.boolean().optional(),
});
export const AskUserQuestionDisplayInputSchema = z.object({
  questions: z.array(QuestionDisplaySchema),
});

const optionalString = z.string().optional();
const inputSchemas: Record<string, z.ZodType> = {
  Read: ReadDisplayInputSchema,
  Write: WriteDisplayInputSchema,
  // Patch-based providers do not supply old_string/new_string. The Edit
  // renderer owns that alternative; only validate these fields when present.
  Edit: z.union([
    z.string(),
    z.object({
      file_path: optionalString,
      old_string: optionalString,
      new_string: optionalString,
      rawPatch: optionalString,
      _rawPatch: optionalString,
      patch: optionalString,
      replace_all: z.boolean().optional(),
    }),
  ]),
  AskUserQuestion: AskUserQuestionDisplayInputSchema,
  ViewImage: z.object({ path: z.string() }),
  Task: z.object({
    prompt: z.string(),
    description: optionalString,
    subagent_type: optionalString,
    model: optionalString,
  }),
  spawn_agent: z.object({
    description: optionalString,
    prompt: optionalString,
    message: optionalString,
    task: optionalString,
    objective: optionalString,
    role: optionalString,
    agent_role: optionalString,
    agent_type: optionalString,
    subagent_type: optionalString,
    model: optionalString,
  }),
};

const mediaFileSchema = z.object({ base64: z.string(), type: z.string() });
const readFileSchema = z.union([
  TextFileDisplaySchema,
  // Claude's read-dedup record omits the body. Keep its "unchanged" display.
  z.object({
    filePath: z.string(),
    content: z.undefined(),
    numLines: z.undefined(),
  }),
  mediaFileSchema,
]);
const resultSchemas: Record<string, z.ZodType> = {
  Read: z.object({ type: optionalString, file: readFileSchema.optional() }),
  Write: z.object({ file: TextFileDisplaySchema.optional() }),
  Edit: z.object({
    filePath: optionalString,
    oldString: optionalString,
    newString: optionalString,
    originalFile: optionalString,
    structuredPatch: z.array(PatchHunkDisplaySchema).optional(),
  }),
  AskUserQuestion: z.object({
    questions: z.array(QuestionDisplaySchema).optional(),
    answers: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional(),
  }),
};

export type ToolDisplayDecision =
  | { kind: "rich" }
  | { kind: "raw"; reason: "input" | "result" };

/** Validate without rewriting the record or stripping provider augmentations.
 * Other tools retain their own guards and the row's exception containment.
 */
export function prepareToolDisplay(
  toolName: string,
  input: unknown,
  result: unknown,
  isError: boolean,
  requireInput = true,
): ToolDisplayDecision {
  const name = canonicalizeToolName(toolName);
  const inputSchema = inputSchemas[name];
  if (
    inputSchema &&
    (requireInput || input !== undefined) &&
    !inputSchema.safeParse(input).success
  ) {
    return { kind: "raw", reason: "input" };
  }
  const resultSchema = resultSchemas[name];
  if (
    !isError &&
    result != null &&
    typeof result !== "string" &&
    resultSchema &&
    !resultSchema.safeParse(result).success
  ) {
    return { kind: "raw", reason: "result" };
  }
  return { kind: "rich" };
}
