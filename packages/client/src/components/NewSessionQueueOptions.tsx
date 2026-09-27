import type { ProviderName } from "@yep-anywhere/shared";
import { type FormEvent, useMemo, useState } from "react";
import { useProjects } from "../hooks/useProjects";
import { getLaunchableProviders, useProviders } from "../hooks/useProviders";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import {
  getPreferredProviderModelId,
  getProviderSessionDefaults,
} from "../lib/newSessionDefaults";
import { sortProjectsForChooser } from "../lib/newSessionProjects";
import styles from "./NewSessionQueueOptions.module.css";
import { Modal } from "./ui/Modal";

/**
 * Where a Project Queue new-session item goes and what it launches with.
 * An absent provider or model means the composer's own session settings.
 */
export interface NewSessionQueueTarget {
  projectId: string;
  provider?: ProviderName;
  model?: string;
}

/** A chosen target plus the project name the confirmation names. */
export interface ChosenNewSessionQueueTarget extends NewSessionQueueTarget {
  projectName?: string;
}

/**
 * Quick options for queueing the composer draft as a new session in any
 * project, with an optional different provider and model. The draft itself is
 * the new session's first turn; this dialog only chooses where it goes.
 */
export function NewSessionQueueOptionsModal({
  initial,
  onSubmit,
  onClose,
}: {
  initial: NewSessionQueueTarget;
  onSubmit: (target: ChosenNewSessionQueueTarget) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { projects } = useProjects();
  const { providers } = useProviders();
  const { settings } = useServerSettings();
  const launchable = useMemo(
    () => getLaunchableProviders(providers),
    [providers],
  );
  const sortedProjects = useMemo(
    () => sortProjectsForChooser(projects, [initial.projectId]),
    [projects, initial.projectId],
  );
  const [projectId, setProjectId] = useState(initial.projectId);
  const [provider, setProvider] = useState<ProviderName | undefined>(
    initial.provider,
  );
  const [model, setModel] = useState<string | undefined>(initial.model);
  const providerModels =
    launchable.find((candidate) => candidate.name === provider)?.models ?? [];

  const chooseProvider = (next: ProviderName) => {
    setProvider(next);
    if (next === initial.provider) {
      setModel(initial.model);
      return;
    }
    const models =
      launchable.find((candidate) => candidate.name === next)?.models ?? [];
    const saved = getProviderSessionDefaults(
      settings?.newSessionDefaults,
      next,
    );
    setModel(
      getPreferredProviderModelId(next, models, saved.model) ?? undefined,
    );
  };

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    onSubmit({
      projectId,
      provider,
      model,
      projectName: sortedProjects.find((project) => project.id === projectId)
        ?.name,
    });
  };

  return (
    <Modal title={t("newSessionQueueOptionsTitle")} onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <p className={styles.hint}>{t("newSessionQueueOptionsHint")}</p>
        <label className={styles.field}>
          <span>{t("newSessionQueueOptionsProject")}</span>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {sortedProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {launchable.length > 0 && (
          <label className={styles.field}>
            <span>{t("newSessionQueueOptionsProvider")}</span>
            <select
              value={provider ?? ""}
              onChange={(event) =>
                chooseProvider(event.target.value as ProviderName)
              }
            >
              {!provider && <option value="" />}
              {launchable.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {providerModels.length > 0 && (
          <label className={styles.field}>
            <span>{t("newSessionQueueOptionsModel")}</span>
            <select
              value={model ?? ""}
              onChange={(event) => setModel(event.target.value || undefined)}
            >
              {(!model ||
                !providerModels.some(
                  (candidate) => candidate.id === model,
                )) && <option value={model ?? ""}>{model ?? ""}</option>}
              {providerModels.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("newSessionQueueOptionsCancel")}
          </button>
          <button type="submit" className="btn-primary">
            {t("newSessionQueueOptionsSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
