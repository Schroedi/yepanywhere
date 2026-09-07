import {
  ACLI_COMMENTARY_MAX_BODY_BYTES,
  ACLI_COMMENTARY_MAX_TEXTS,
  ACLI_COMMENTARY_RENDERING_CAPABILITY,
  declaresAcliCommentary,
  serverHasCapability,
} from "@yep-anywhere/shared";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useOptionalSessionMetadata } from "../contexts/SessionMetadataContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useAcliCommentarySetting } from "../hooks/useAcliCommentarySetting";
import { useRetainedVersionInfo } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import {
  AcliToolOutput,
  type AcliOutputProjection,
} from "../lib/acliToolOutput";
import { getDisplayBashCommandFromInput } from "../lib/bashCommand";
import type { YaSourceRuntime } from "../lib/sourceRuntime";
import type { ToolCallItem, ToolResultData } from "../types/renderItems";
import { AcliCommentary } from "./AcliCommentary";
import { ActivityDetailModal } from "./ActivityDetailModal";
import {
  BashModalContent,
  normalizeBashResult,
} from "./renderers/tools/BashRenderer";
import type { BashInput, BashResult } from "./renderers/tools/types";

interface Props {
  id: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResultData;
  status: ToolCallItem["status"];
  children: (input: unknown, result: ToolResultData | undefined) => ReactNode;
}

interface Output {
  stdout: string;
  stderr: string;
  shell: BashResult | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readOutput(
  props: Pick<Props, "toolName" | "toolInput" | "toolResult">,
): Output {
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
    return { stdout: shell.stdout ?? "", stderr: shell.stderr ?? "", shell };
  }
  const structured = record(raw);
  return {
    stdout:
      typeof structured?.stdout === "string"
        ? structured.stdout
        : (props.toolResult?.content ?? ""),
    stderr: typeof structured?.stderr === "string" ? structured.stderr : "",
    shell: null,
  };
}

export function ToolCommentaryBoundary(props: Props) {
  const { acliCommentaryEnabled } = useAcliCommentarySetting();
  const metadata = useOptionalSessionMetadata();
  const publicShare = usePublicShareContext();
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  if (!acliCommentaryEnabled || !metadata || publicShare)
    return props.children(props.toolInput, props.toolResult);
  return (
    <InvocationBoundary
      key={`${runtime.sourceKey}:${metadata.projectId}:${metadata.sessionId}:${props.id}`}
      {...props}
      projectId={metadata.projectId}
      runtime={runtime}
      supported={
        version
          ? serverHasCapability(version, ACLI_COMMENTARY_RENDERING_CAPABILITY)
          : null
      }
    />
  );
}

function InvocationBoundary(
  props: Props & {
    projectId: string;
    runtime: YaSourceRuntime;
    supported: boolean | null;
  },
) {
  const output = useMemo(
    () =>
      readOutput({
        toolName: props.toolName,
        toolInput: props.toolInput,
        toolResult: props.toolResult,
      }),
    [props.toolResult, props.toolInput, props.toolName],
  );
  const [mode, setMode] = useState<"commentary" | "raw" | null>(null);
  const declared = [
    output.stdout.slice(0, 4096),
    output.stderr.slice(0, 4096),
  ].some((text) => text.split("\n").some(declaresAcliCommentary));
  if (mode === null) {
    if (props.supported === false) setMode("raw");
    else if (declared && props.supported) setMode("commentary");
    else if (
      !declared &&
      (props.status !== "pending" || output.stdout.includes("\n"))
    )
      setMode("raw");
  }
  if (mode === "commentary")
    return <CommentaryOutput {...props} output={output} />;
  if (mode === "raw") return props.children(props.toolInput, props.toolResult);
  // Do not publish an undecided record, then move its metadata after paint.
  const input = record(props.toolInput);
  return props.children(
    input ? { ...input, _previewResult: undefined } : props.toolInput,
    undefined,
  );
}

const completed = new WeakMap<
  ToolResultData,
  { sourceKey: string; source: string; projection: AcliOutputProjection }
>();

function CommentaryOutput(
  props: Props & {
    projectId: string;
    runtime: YaSourceRuntime;
    output: Output;
  },
) {
  const { t } = useI18n();
  const [initial] = useState(() => {
    const cached = props.toolResult
      ? completed.get(props.toolResult)
      : undefined;
    return cached?.sourceKey === props.runtime.sourceKey &&
      cached.source === props.output.stdout &&
      props.status !== "pending"
      ? cached
      : null;
  });
  const [projection, setProjection] = useState<AcliOutputProjection | null>(
    initial?.projection ?? null,
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const engine = useRef<AcliToolOutput | null>(null);
  const restart = useRef<(() => void) | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const command =
    getDisplayBashCommandFromInput(props.toolInput) || props.toolName;

  useEffect(() => {
    let abort = new AbortController();
    const create = (cached?: {
      source: string;
      projection: AcliOutputProjection;
    }) =>
      new AcliToolOutput(
        async (texts) => {
          const signal = abort.signal;
          const html: string[] = [];
          for (let offset = 0; offset < texts.length; ) {
            let count = Math.min(
              ACLI_COMMENTARY_MAX_TEXTS,
              texts.length - offset,
            );
            let body = JSON.stringify({
              texts: texts.slice(offset, offset + count),
            });
            while (
              new TextEncoder().encode(body).length >
                ACLI_COMMENTARY_MAX_BODY_BYTES &&
              count > 1
            ) {
              count = Math.floor(count / 2);
              body = JSON.stringify({
                texts: texts.slice(offset, offset + count),
              });
            }
            if (
              new TextEncoder().encode(body).length >
              ACLI_COMMENTARY_MAX_BODY_BYTES
            )
              throw new Error("Commentary exceeds rendering limit");
            const response = await props.runtime.transport.fetch<{
              html: string[];
            }>(`/projects/${props.projectId}/tool-commentary/render`, {
              method: "POST",
              body,
              signal,
            });
            if (
              !Array.isArray(response.html) ||
              response.html.length !== count ||
              response.html.some((value) => typeof value !== "string")
            )
              throw new Error("Invalid commentary response");
            html.push(...response.html);
            offset += count;
          }
          return html;
        },
        (next) => {
          setProjection(next);
          const current = latest.current;
          if (
            next.complete &&
            current.toolResult &&
            current.status !== "pending"
          )
            completed.set(current.toolResult, {
              sourceKey: current.runtime.sourceKey,
              source: current.output.stdout,
              projection: next,
            });
        },
        cached,
      );
    restart.current = () => {
      abort.abort();
      engine.current?.stop();
      abort = new AbortController();
      engine.current = create();
      const current = latest.current;
      engine.current.appendSnapshot(
        current.output.stdout,
        current.status !== "pending",
      );
    };
    engine.current = create(initial ?? undefined);
    const current = latest.current;
    engine.current.appendSnapshot(
      current.output.stdout,
      current.status !== "pending",
    );
    return () => {
      abort.abort();
      engine.current?.stop();
      engine.current = null;
      restart.current = null;
    };
  }, [props.projectId, props.runtime, initial]);

  useEffect(() => {
    if (!engine.current) return;
    if (
      !engine.current.appendSnapshot(
        props.output.stdout,
        props.status !== "pending",
      )
    ) {
      // Reconcile a replacement atomically after rendering; never mix the old
      // invocation's context with its replacement or flash raw metadata.
      restart.current?.();
    }
  }, [props.output.stdout, props.status]);

  const closeViewer = useCallback(() => setViewerOpen(false), []);
  const openViewer = useCallback(() => setViewerOpen(true), []);
  const projectedResult = useMemo(() => {
    if (!projection) return undefined;
    const stderr = props.output.stderr
      .split("\n")
      .filter((line) => !declaresAcliCommentary(line))
      .join("\n");
    return {
      ...props.toolResult,
      content: projection.stdout,
      isError: props.toolResult?.isError ?? false,
      structured: props.output.shell
        ? { ...props.output.shell, stdout: projection.stdout, stderr }
        : undefined,
    };
  }, [props.toolResult, props.output, projection]);
  const projectedInput = useMemo(() => {
    const input = record(props.toolInput);
    return input
      ? { ...input, _previewResult: projectedResult?.structured }
      : props.toolInput;
  }, [props.toolInput, projectedResult]);
  return (
    <>
      {props.children(projectedInput, projectedResult)}
      {projection ? (
        <AcliCommentary
          items={projection.commentary}
          command={command}
          onOpenOutput={openViewer}
        />
      ) : null}
      {projection?.failed ? (
        <span role="status">{t("acliCommentaryUnavailable")}</span>
      ) : null}
      {viewerOpen ? (
        <ActivityDetailModal
          title={command}
          label={command}
          onClose={closeViewer}
        >
          {props.output.shell ? (
            <BashModalContent
              input={props.toolInput as BashInput}
              result={projectedResult?.structured as BashResult}
              isError={props.toolResult?.isError ?? false}
              projectPathLinks={props.toolResult?.projectPathLinks}
            />
          ) : (
            <pre>{projection?.stdout}</pre>
          )}
          <details>
            <summary>{t("workflowOriginalOutput")}</summary>
            <pre>
              {props.output.stdout}
              {props.output.stderr ? `\n${props.output.stderr}` : ""}
            </pre>
          </details>
        </ActivityDetailModal>
      ) : null}
    </>
  );
}
