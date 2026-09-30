import { useEffect, useState } from "react";
import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useActingPrincipal } from "../hooks/useActingPrincipal";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import {
  DraftSyncClient,
  DRAFT_SYNC_STATUS_EVENT,
  acceptPendingDrafts,
  discardPendingDrafts,
  draftSyncPending,
  setDraftAccount,
} from "../lib/draftSyncStorage";
import styles from "./DraftSyncBridge.module.css";

export function DraftSyncBridge() {
  const runtime = useCurrentSourceRuntime();
  const { version } = useVersion();
  const { principal, resolved } = useActingPrincipal();
  const { t } = useI18n();
  const [pending, setPending] = useState(() =>
    draftSyncPending(runtime.sourceKey),
  );
  const owner = principal.username ?? "";
  const supported = serverHasCapability(
    version ?? undefined,
    SERVER_CAPABILITIES.draftSync.name,
  );
  useEffect(() => {
    if (!resolved) return;
    setDraftAccount(runtime.sourceKey, owner);
    if (!supported) return;
    const client = new DraftSyncClient(
      runtime.sourceKey,
      owner,
      runtime.transport,
    );
    client.start();
    return () => client.stop();
  }, [runtime, owner, resolved, supported]);
  useEffect(() => {
    const update = () => setPending(draftSyncPending(runtime.sourceKey));
    window.addEventListener(DRAFT_SYNC_STATUS_EVENT, update);
    update();
    return () => window.removeEventListener(DRAFT_SYNC_STATUS_EVENT, update);
  }, [runtime.sourceKey]);
  if (!pending.length) return null;
  const problem = pending.some((p) => p.error);
  const localFailure = pending.some((p) => p.error === "local");
  return (
    <aside className={styles.notice} role="status">
      <span>
        {localFailure
          ? t("draftSyncLocalFailure")
          : problem
            ? t("draftSyncWaiting")
            : pending.some((p) => p.recovery)
              ? t("draftSyncRecovery")
              : t("draftSyncPending")}
      </span>
      <button
        type="button"
        onClick={() => acceptPendingDrafts(runtime.sourceKey)}
      >
        {problem ? t("draftSyncRetry") : t("draftSyncReview")}
      </button>
      <button
        type="button"
        aria-label={t("draftSyncDismiss")}
        onClick={() => discardPendingDrafts(runtime.sourceKey)}
      >
        {t("draftSyncDismissShort")}
      </button>
    </aside>
  );
}
