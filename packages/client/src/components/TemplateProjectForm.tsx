import { useEffect, useId, useRef, useState } from "react";
import {
  projectTemplatesApi,
  type ProjectTemplateChoice,
  type TemplateCreationOperation,
  type TemplateCreationRequest,
} from "../api/projectTemplatesClient";
import { useI18n } from "../i18n";
import { pathForProjectName } from "../lib/newProjectPath";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import type { Project } from "../types";
import styles from "./TemplateProjectForm.module.css";

interface Props {
  templates: ProjectTemplateChoice[];
  projects: readonly Project[];
  pathBase: string;
  initialName?: string;
  intent?: string;
  sessionSettings?: Record<string, unknown>;
  onBusyChange?: (busy: boolean) => void;
  disabledReason?: string;
  onStarted: (projectId: string, sessionId: string) => void;
}

/** The same template radio palette and creation operation in both project entry points. */
export function TemplateProjectForm({
  templates,
  projects,
  pathBase,
  initialName = "",
  intent,
  sessionSettings = {},
  onBusyChange,
  disabledReason,
  onStarted,
}: Props) {
  const { t } = useI18n();
  const sourceKey = useClientSummarySourceKey();
  const storageKey = `ya-template-creation:${sourceKey}`;
  const id = useId();
  const [name, setName] = useState(initialName);
  const [nameEdited, setNameEdited] = useState(false);
  const [parent, setParent] = useState(pathBase);
  const [description, setDescription] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [operation, setOperation] = useState<TemplateCreationOperation | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<TemplateCreationRequest | null>(null);
  const completed = useRef(false);
  const recovered = useRef(false);
  const selected =
    templates.find((item) => `${item.sourceId}/${item.id}` === selection) ??
    (selection === null ? templates[0] : undefined);
  const path =
    request.current?.path ?? pathForProjectName(name, parent, projects, false);
  const effectiveIntent = intent ?? description;
  const running =
    operation !== null &&
    !["started", "failed", "interrupted"].includes(operation.phase);
  const locked = pending || operation !== null || request.current !== null;

  useEffect(() => {
    onBusyChange?.(
      pending || running || (request.current !== null && operation === null),
    );
  }, [pending, running, operation, onBusyChange]);

  useEffect(() => {
    if (recovered.current) return;
    recovered.current = true;
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;
    const retained = JSON.parse(saved) as TemplateCreationRequest;
    request.current = retained;
    setName(retained.name);
    setNameEdited(true);
    setDescription(retained.intent);
    setSelection(`${retained.sourceId}/${retained.templateId}`);
    setPending(true);
    void projectTemplatesApi
      .create(retained)
      .then(setOperation)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setPending(false));
  }, [storageKey]);

  useEffect(() => {
    if (!nameEdited && !request.current) setName(initialName);
  }, [initialName, nameEdited]);

  useEffect(() => {
    if (!operation || !running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await projectTemplatesApi.operation(
          operation.request.operationId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setOperation(next);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        timer = setTimeout(() => void poll(), 2000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [operation, running]);

  useEffect(() => {
    if (
      !completed.current &&
      operation?.phase === "started" &&
      operation.projectId &&
      operation.sessionId
    ) {
      completed.current = true;
      sessionStorage.removeItem(storageKey);
      onStarted(operation.projectId, operation.sessionId);
    }
  }, [operation, onStarted, storageKey]);

  const create = async () => {
    if (
      pending ||
      disabledReason ||
      !selected ||
      !name.trim() ||
      !effectiveIntent.trim() ||
      !path
    )
      return;
    request.current ??= {
      operationId: crypto.randomUUID(),
      sourceId: selected.sourceId,
      templateId: selected.id,
      path,
      name,
      intent: effectiveIntent,
      session: sessionSettings,
    };
    setPending(true);
    setError(null);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request.current));
      setOperation(await projectTemplatesApi.create(request.current));
    } catch (caught) {
      if (
        caught &&
        typeof caught === "object" &&
        "status" in caught &&
        [400, 403, 409].includes(Number(caught.status))
      ) {
        request.current = null;
        sessionStorage.removeItem(storageKey);
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={styles.form} aria-label={t("templateNewProject")}>
      <fieldset className={styles.palette} disabled={locked}>
        <legend>{t("templateChoose")}</legend>
        {templates.map((item) => (
          <label className={styles.choice} key={`${item.sourceId}/${item.id}`}>
            <input
              type="radio"
              name={`${id}-template`}
              checked={selected === item}
              onChange={() => setSelection(`${item.sourceId}/${item.id}`)}
            />
            {item.icon && (
              <img className={styles.icon} src={item.icon} alt="" />
            )}
            <span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
          </label>
        ))}
        {templates.length === 0 && <p>{t("templateNoReady")}</p>}
      </fieldset>
      {selected?.preview && (
        <img
          className={styles.preview}
          src={selected.preview}
          alt={selected.title}
        />
      )}
      <label className={styles.field}>
        {t("projectsAddNameLabel")}
        <input
          value={name}
          onChange={(e) => {
            setNameEdited(true);
            setName(e.target.value);
          }}
          disabled={locked}
          placeholder={t("templateNameExample")}
        />
      </label>
      {intent === undefined && (
        <label className={styles.field}>
          {t("templateIntent")}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={locked}
            rows={3}
            placeholder={t("templateIntentExample")}
          />
        </label>
      )}
      <label className={styles.field}>
        {t("templateParent")}
        <input
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          disabled={locked}
        />
      </label>
      {path && <small className={styles.path}>{path}</small>}
      <button
        type="button"
        className={styles.action}
        onClick={() => void create()}
        disabled={
          pending ||
          !!disabledReason ||
          operation !== null ||
          !selected ||
          !name.trim() ||
          !effectiveIntent.trim() ||
          !path
        }
      >
        {pending ? t("projectsAdding") : t("templateCreatePrepare")}
      </button>
      {disabledReason && <p role="status">{disabledReason}</p>}
      {operation && (
        <div role="status">
          <p>{t(`templatePhase_${operation.phase}`)}</p>
          {operation.error && <p role="alert">{operation.error}</p>}
          {operation.log && (
            <details>
              <summary>{t("templateSetupLog")}</summary>
              <pre className={styles.log}>{operation.log}</pre>
            </details>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {operation && ["failed", "interrupted"].includes(operation.phase) && (
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            sessionStorage.removeItem(storageKey);
            request.current = null;
            setOperation(null);
            setError(null);
          }}
        >
          {t("templateReset")}
        </button>
      )}
    </section>
  );
}
