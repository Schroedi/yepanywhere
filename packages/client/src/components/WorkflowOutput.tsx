import { Fragment, type ReactNode, useId, useState } from "react";
import { useI18n } from "../i18n";
import type {
  WorkflowAnnotation,
  WorkflowMarker,
} from "../lib/transcriptProjection/workflowTags";
import styles from "./WorkflowOutput.module.css";
import { TimelineDisclosure } from "./TimelineDisclosure";
import { SessionFilePathLink } from "./SessionFilePathLink";
import { workflowSchemaReference } from "../lib/transcriptProjection/workflowTags";

function SchemaLabel({ marker }: { marker: WorkflowMarker }) {
  const { t } = useI18n();
  const label =
    marker.kind === "unresolved"
      ? t("workflowSchemaUnresolved")
      : t("workflowSchemaActivated", { title: marker.title });
  const reference = marker.schemaRef
    ? workflowSchemaReference(marker.schemaRef)
    : undefined;
  return reference ? (
    <SessionFilePathLink
      displayPath={label}
      filePath={reference.path}
      showCopyButton={false}
      showVersionControlLinks={false}
    />
  ) : (
    label
  );
}

export function WorkflowBoundary({ marker }: { marker: WorkflowMarker }) {
  return (
    <span
      className={styles.boundary}
      data-workflow-boundary={marker.kind}
      data-workflow-path={marker.path}
    >
      {marker.kind !== "activation" && marker.kind !== "unresolved" && (
        <mark className={styles.tag}>{marker.prefix}</mark>
      )}
      {marker.kind !== "activation" || marker.title ? (
        <span className={styles.title}>
          {marker.kind === "unresolved" || marker.kind === "activation" ? (
            <SchemaLabel marker={marker} />
          ) : (
            marker.title
          )}
        </span>
      ) : null}
    </span>
  );
}

export function WorkflowContext({
  workflow,
}: {
  workflow: WorkflowAnnotation;
}) {
  return (
    <>
      {workflow.parent ? (
        <div
          className={styles.context}
          data-workflow-parent={workflow.parent.path}
        >
          {workflow.parent.title}
        </div>
      ) : null}
      {workflow.markers
        .filter(
          (marker) =>
            !workflow.view &&
            (marker.kind === "activation" || marker.kind === "unresolved"),
        )
        .map((marker) => (
          <div
            key={marker.start}
            className={styles.context}
            title={marker.prefix}
            data-workflow-schema={marker.kind}
          >
            <SchemaLabel marker={marker} />
          </div>
        ))}
    </>
  );
}

export function WorkflowOutput({
  text,
  workflow,
  original,
  preview,
}: {
  text: string;
  workflow: WorkflowAnnotation;
  original?: ReactNode;
  preview?: ReactNode;
}) {
  const { t } = useI18n();
  const [originalExpanded, setOriginalExpanded] = useState(false);
  const originalId = useId();
  const content: ReactNode[] = [];
  let markerIndex = 0;
  for (const range of workflow.visibleRanges ?? [
    { start: 0, end: text.length },
  ]) {
    let offset = range.start;
    while (markerIndex < workflow.markers.length) {
      const marker = workflow.markers[markerIndex]!;
      if (marker.start >= range.end) break;
      markerIndex++;
      if (marker.start < range.start) continue;
      content.push(
        <Fragment key={marker.start}>
          {text.slice(offset, marker.start)}
          <WorkflowBoundary marker={marker} />
        </Fragment>,
      );
      offset = marker.end;
    }
    content.push(text.slice(offset, range.end));
  }
  return (
    <div className={`${styles.root} timeline-item`} data-workflow-output="true">
      <TimelineDisclosure
        expanded={originalExpanded}
        label={t(
          originalExpanded ? "workflowHideOriginal" : "workflowShowOriginal",
        )}
        controls={originalId}
        onClick={() => setOriginalExpanded((value) => !value)}
      />
      {preview ?? <pre className={styles.content}>{content}</pre>}
      {originalExpanded && (
        <div
          className={styles.original}
          id={originalId}
          data-workflow-original="true"
        >
          {original ?? <pre className={styles.content}>{text}</pre>}
        </div>
      )}
    </div>
  );
}
