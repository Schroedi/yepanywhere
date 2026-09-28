import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import {
  projectTemplatesApi,
  type ProjectTemplateChoices,
} from "../api/projectTemplatesClient";
import { useActingPrincipal } from "./useActingPrincipal";
import { useVersion } from "./useVersion";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";

/** Acquires template choices only after server and acting-principal gates settle. */
export function useProjectTemplateChoices(chooserOpen = false) {
  const { version } = useVersion();
  const sourceKey = useClientSummarySourceKey();
  const { principal, resolved } = useActingPrincipal();
  const superuser = resolved && principal.username === null;
  const supported =
    superuser &&
    serverHasCapability(
      version,
      SERVER_CAPABILITIES.projectTemplateCreation.name,
    );
  const [choices, setChoices] = useState<ProjectTemplateChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    if (!supported) setChoices(null);
    if (supported)
      void projectTemplatesApi
        .choices(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setChoices(result);
            setLoadedSource(sourceKey);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setChoices(null);
            setLoadedSource(sourceKey);
            setError(error instanceof Error ? error.message : String(error));
          }
        });
    return () => controller.abort();
  }, [supported, sourceKey, chooserOpen]);
  return {
    choices: supported && loadedSource === sourceKey ? choices : null,
    error: supported && loadedSource === sourceKey ? error : null,
  };
}
