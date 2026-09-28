import { useEffect, useState } from "react";
import { projectAppApi } from "../api/projectApp";

/**
 * Whether the project declares a root app (topics/project-service.md
 * § Project App and Settings), so a session can offer the project App
 * without having been opened from the project's App entry. A failed lookup
 * offers nothing rather than a button that opens an error.
 */
export function useProjectDeclaresApp(
  projectId: string | undefined,
  enabled: boolean,
): boolean {
  const [declared, setDeclared] = useState<{ projectId: string } | null>(null);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let active = true;
    void projectAppApi
      .info(projectId)
      .then((info) => {
        if (active && (info.declaration || info.activeDeclaration))
          setDeclared({ projectId });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, enabled]);
  return enabled && declared?.projectId === projectId;
}
