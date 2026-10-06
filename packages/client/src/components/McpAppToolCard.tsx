import {
  type McpAppDisplayMode,
  type McpAppToolCall,
  SERVER_CAPABILITIES,
  serverHasCapability,
} from "@yep-anywhere/shared";
import type {
  ToolCallItem,
  ToolResultData,
} from "@yep-anywhere/shared/transcript/items";
import { useCallback, useContext, useState } from "react";
import { ComposerInsertContext } from "../contexts/ComposerInsertContext";
import { useOptionalSessionMetadata } from "../contexts/SessionMetadataContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useServerSettings } from "../hooks/useServerSettings";
import { useRetainedVersionInfo } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import { artifactAudience, artifactOrigin } from "../lib/artifactPreview";
import { McpAppView } from "./McpAppView";
import styles from "./McpAppToolCard.module.css";
import { SessionManagedPanel } from "./SessionManagedViewer";

type CardMode = "closed" | McpAppDisplayMode;

/**
 * The launcher and inline host for a tool call's MCP App view. Nothing loads
 * until the reader asks: replayed history never re-runs a view on its own.
 * Inline mode frames the view in the row; fullscreen mode hands it to the
 * session's managed viewer, which is the right pane when that is enabled and
 * a covering modal otherwise.
 */
export function McpAppToolCard({
  mcpApp,
  callId,
  toolInput,
  toolResult,
  status,
}: {
  mcpApp: McpAppToolCall;
  callId: string;
  toolInput: unknown;
  toolResult?: ToolResultData;
  status: ToolCallItem["status"];
}) {
  const { t } = useI18n();
  const metadata = useOptionalSessionMetadata();
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const { settings } = useServerSettings();
  const insertIntoComposer = useContext(ComposerInsertContext);
  const [mode, setMode] = useState<CardMode>("closed");
  const close = useCallback(() => setMode("closed"), []);
  const requestDisplayMode = useCallback(
    (requested: string): McpAppDisplayMode => {
      if (requested === "inline" || requested === "fullscreen") {
        setMode(requested);
        return requested;
      }
      return mode === "closed" ? mcpApp.displayMode : mode;
    },
    [mode, mcpApp.displayMode],
  );

  if (
    !metadata ||
    settings?.mcpAppViews !== true ||
    !serverHasCapability(version, SERVER_CAPABILITIES.mcpAppViews.name)
  )
    return null;
  const config = version?.artifactViewer;
  const proxyOrigin = config
    ? artifactOrigin(
        config,
        artifactAudience(window.location.hostname),
        window.location.href,
      )
    : undefined;
  if (!proxyOrigin)
    return <p className={styles.note}>{t("mcpAppViewNeedsArtifactOrigin")}</p>;

  const label = t("mcpAppViewFrame", {
    server: mcpApp.server,
    tool: mcpApp.tool,
  });
  const view = (displayMode: McpAppDisplayMode) => (
    <McpAppView
      call={mcpApp}
      callId={callId}
      projectId={metadata.projectId}
      sessionId={metadata.sessionId}
      proxyOrigin={proxyOrigin}
      toolInput={toolInput}
      toolResult={toolResult}
      status={status}
      displayMode={displayMode}
      onRequestDisplayMode={requestDisplayMode}
      insertIntoComposer={insertIntoComposer}
    />
  );

  return (
    <div className={styles.card}>
      <div className={styles.actions}>
        {mode === "closed" ? (
          <button
            type="button"
            className={styles.action}
            onClick={() => setMode(mcpApp.displayMode)}
          >
            {t("mcpAppViewShow")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={styles.action}
              onClick={() =>
                setMode(mode === "inline" ? "fullscreen" : "inline")
              }
            >
              {t(
                mode === "inline" ? "mcpAppViewExpand" : "mcpAppViewShowInline",
              )}
            </button>
            <button type="button" className={styles.action} onClick={close}>
              {t("mcpAppViewClose")}
            </button>
          </>
        )}
      </div>
      {mode === "inline" && view("inline")}
      {mode === "fullscreen" && (
        <SessionManagedPanel
          viewerId={`mcp-app:${callId}`}
          sessionId={metadata.sessionId}
          title={label}
          label={label}
          onClose={close}
        >
          {view("fullscreen")}
        </SessionManagedPanel>
      )}
    </div>
  );
}
