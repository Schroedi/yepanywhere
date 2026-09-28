import { z } from "zod";

const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => character.charCodeAt(0) < 32);

const relativePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !/[\\:]/.test(value) &&
      !hasControlCharacters(value) &&
      value
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            part.toLowerCase() !== ".git",
        ),
  );
const directory = z.union([z.literal("."), relativePath]);
const appPath = z
  .string()
  .max(4096)
  .refine((value) => {
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      /[\\ ?#]/.test(value) ||
      hasControlCharacters(value)
    )
      return false;
    try {
      return decodeURIComponent(value)
        .split("/")
        .every((part) => part !== ".." && part !== ".");
    } catch {
      return false;
    }
  });

/** Source-owned service declaration; observed state and hostnames live in YA data. */
export const projectServiceSchema = z.union([
  z.strictObject({
    version: z.literal(1),
    where: z.strictObject({
      kind: z.literal("static"),
      root: directory,
      entry: relativePath,
    }),
    serving: z.strictObject({ target: z.literal("static-root") }),
  }),
  z.strictObject({
    version: z.literal(1),
    where: z.strictObject({
      kind: z.literal("process"),
      cwd: directory,
      entry: appPath,
    }),
    start: z.strictObject({
      argv: z
        .array(
          z
            .string()
            .min(1)
            .max(8192)
            .refine((value) => !value.includes("\0")),
        )
        .min(1)
        .max(64),
      portEnv: z
        .string()
        .regex(/^(?:PORT|[A-Z][A-Z0-9_]*_PORT)$/)
        .refine((value) => !/^(?:YA_|YEP_|AGENT_)/.test(value)),
    }),
    status: z.strictObject({
      probe: z.literal("http"),
      path: appPath,
      readyStatus: z.number().int().min(200).max(299),
      startupTimeoutMs: z.number().int().min(100).max(120_000),
    }),
    stop: z.strictObject({
      signal: z.literal("SIGTERM"),
      graceMs: z.number().int().min(100).max(30_000),
    }),
    serving: z.strictObject({
      target: z.literal("sandbox-loopback"),
      protocol: z.literal("http"),
    }),
  }),
]);

export type ProjectServiceDeclaration = z.infer<typeof projectServiceSchema>;
