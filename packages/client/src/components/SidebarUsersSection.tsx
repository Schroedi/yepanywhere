import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActingPrincipal,
  LimitedUserSummary,
  ProjectAccessLevel,
} from "@yep-anywhere/shared";
import {
  JOIN_STALE_OFFSET_MAX_MINUTES,
  JOIN_STALE_OFFSET_MIN_MINUTES,
} from "@yep-anywhere/shared";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import { useProjects } from "../hooks/useProjects";
import { useProviders } from "../hooks/useProviders";
import styles from "./SidebarUsersSection.module.css";

/**
 * The sidebar's Users section: who this client is acting as, switching into a
 * limited user, creating and editing them, and logging out.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Users section in the
 * sidebar. Everything here is presentation: the server enforces the same
 * grants at the operation, so hiding a control is never the protection.
 */

const EFFORT_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface SidebarUsersSectionProps {
  principal: ActingPrincipal;
  /** Re-read the acting principal after a switch or logout. */
  onPrincipalChanged: () => void;
  isCollapsed?: boolean;
}

interface DraftState {
  username: string;
  password: string;
  access: Record<string, ProjectAccessLevel>;
  joinStaleOffsetMinutes: number;
  provider: string;
  model: string;
  effort: string;
}

const EMPTY_DRAFT: DraftState = {
  username: "",
  password: "",
  access: {},
  joinStaleOffsetMinutes: 0,
  provider: "",
  model: "",
  effort: "",
};

function draftFromUser(user: LimitedUserSummary): DraftState {
  const access: Record<string, ProjectAccessLevel> = {};
  for (const id of user.viewProjects) access[id] = "view";
  for (const id of user.joinProjects) access[id] = "join";
  for (const id of user.newSessionProjects) access[id] = "new-session";
  return {
    username: user.username,
    password: "",
    access,
    joinStaleOffsetMinutes: user.joinStaleOffsetMinutes,
    provider: user.lock.provider ?? "",
    model: user.lock.model ?? "",
    effort: user.lock.effort ?? "",
  };
}

function grantsFromDraft(draft: DraftState) {
  const newSessionProjects: string[] = [];
  const joinProjects: string[] = [];
  const viewProjects: string[] = [];
  for (const [projectId, level] of Object.entries(draft.access)) {
    if (level === "new-session") newSessionProjects.push(projectId);
    else if (level === "join") joinProjects.push(projectId);
    else if (level === "view") viewProjects.push(projectId);
  }
  return {
    newSessionProjects,
    joinProjects,
    viewProjects,
    joinStaleOffsetMinutes: draft.joinStaleOffsetMinutes,
    lock: {
      ...(draft.provider ? { provider: draft.provider } : {}),
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.effort ? { effort: draft.effort } : {}),
    },
  };
}

export function SidebarUsersSection({
  principal,
  onPrincipalChanged,
  isCollapsed,
}: SidebarUsersSectionProps) {
  const { t } = useI18n();
  const actingAsLimited = principal.username !== null;
  // Managing users is the superuser's own surface: while switched into a
  // limited user every /api/users call is refused, which is the point.
  const canManage =
    principal.superuser && principal.enabled && !principal.switched;

  const [users, setUsers] = useState<LimitedUserSummary[]>([]);
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!canManage) return;
    try {
      const response = await api.listUsers();
      setUsers(response.users);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [canManage]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const switchTo = async (username: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.switchUser(username);
      onPrincipalChanged();
      // Acting as a different principal changes every list on screen.
      window.location.reload();
    } catch (switchError) {
      setError((switchError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      const result = await api.logoutUser();
      onPrincipalChanged();
      if (result.redirect === "relay-login") {
        window.location.href = "/login/relay";
      } else if (result.redirect === "direct-login") {
        window.location.href = "/login";
      } else {
        window.location.reload();
      }
    } catch (logoutError) {
      setError((logoutError as Error).message);
      setBusy(false);
    }
  };

  if (isCollapsed) {
    // The mini rail has no room for the panel; the caption below is the
    // identity signal, and it needs the expanded sidebar.
    return actingAsLimited ? (
      <div className={styles.railBadge} title={principal.username ?? ""}>
        {(principal.username ?? "?").slice(0, 2)}
      </div>
    ) : null;
  }

  if (!canManage && !actingAsLimited) return null;

  return (
    <section className={styles.section} aria-label={t("usersSectionTitle")}>
      <header className={styles.header}>
        <span className={styles.title}>{t("usersSectionTitle")}</span>
        <span className={styles.caption}>
          {principal.username ?? t("usersSuperuser")}
        </span>
      </header>

      {actingAsLimited && principal.switched && (
        <p className={styles.note}>{t("usersActingAsNote")}</p>
      )}

      {canManage && (
        <div className={styles.actions}>
          <select
            className={styles.select}
            value={principal.username ?? ""}
            disabled={busy}
            onChange={(event) => void switchTo(event.target.value || null)}
            aria-label={t("usersSwitchLabel")}
          >
            <option value="">{t("usersSuperuser")}</option>
            {users.map((user) => (
              <option key={user.username} value={user.username}>
                {user.username}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setManaging((open) => !open);
              setEditing(null);
              setDraft(EMPTY_DRAFT);
            }}
          >
            {managing ? t("usersManageClose") : t("usersManageOpen")}
          </button>
        </div>
      )}

      <button
        type="button"
        className={styles.logout}
        disabled={busy}
        onClick={() => void logout()}
      >
        {principal.switched ? t("usersReturnToSuperuser") : t("usersLogout")}
      </button>

      {!principal.superuser && principal.grants && (
        <ReadOnlyGrants principal={principal} />
      )}

      {canManage && managing && (
        <ManagePanel
          users={users}
          editing={editing}
          draft={draft}
          error={error}
          busy={busy}
          onSelectUser={(username) => {
            setEditing(username);
            const user = users.find((entry) => entry.username === username);
            setDraft(user ? draftFromUser(user) : EMPTY_DRAFT);
          }}
          onDraftChange={setDraft}
          onSubmit={async () => {
            setBusy(true);
            setError(null);
            try {
              const grants = grantsFromDraft(draft);
              if (editing) {
                await api.updateUser(editing, {
                  ...grants,
                  ...(draft.password ? { password: draft.password } : {}),
                });
              } else {
                await api.createUser({
                  username: draft.username,
                  password: draft.password,
                  ...grants,
                });
              }
              setDraft(EMPTY_DRAFT);
              setEditing(null);
              await loadUsers();
            } catch (submitError) {
              setError((submitError as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onDelete={async (username) => {
            setBusy(true);
            try {
              await api.deleteUser(username);
              setEditing(null);
              setDraft(EMPTY_DRAFT);
              await loadUsers();
            } catch (deleteError) {
              setError((deleteError as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {error && !managing && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function ReadOnlyGrants({ principal }: { principal: ActingPrincipal }) {
  const { t } = useI18n();
  const grants = principal.grants;
  if (!grants) return null;
  const lock = [grants.lock.provider, grants.lock.model, grants.lock.effort]
    .filter(Boolean)
    .join(" · ");
  return (
    <dl className={styles.grants}>
      <dt>{t("usersGrantNewSession")}</dt>
      <dd>{grants.newSessionProjects.length}</dd>
      <dt>{t("usersGrantJoin")}</dt>
      <dd>{grants.joinProjects.length}</dd>
      <dt>{t("usersGrantView")}</dt>
      <dd>{grants.viewProjects.length}</dd>
      {lock && (
        <>
          <dt>{t("usersGrantLock")}</dt>
          <dd>{lock}</dd>
        </>
      )}
    </dl>
  );
}

interface ManagePanelProps {
  users: LimitedUserSummary[];
  editing: string | null;
  draft: DraftState;
  error: string | null;
  busy: boolean;
  onSelectUser: (username: string | null) => void;
  onDraftChange: (draft: DraftState) => void;
  onSubmit: () => Promise<void>;
  onDelete: (username: string) => Promise<void>;
}

function ManagePanel({
  users,
  editing,
  draft,
  error,
  busy,
  onSelectUser,
  onDraftChange,
  onSubmit,
  onDelete,
}: ManagePanelProps) {
  const { t } = useI18n();
  const { projects } = useProjects();
  const { providers } = useProviders();

  const models = useMemo(() => {
    const provider = providers.find((entry) => entry.name === draft.provider);
    return provider?.models ?? [];
  }, [providers, draft.provider]);

  return (
    <div className={styles.manage}>
      <div className={styles.manageRow}>
        <select
          className={styles.select}
          value={editing ?? ""}
          onChange={(event) => onSelectUser(event.target.value || null)}
          aria-label={t("usersEditLabel")}
        >
          <option value="">{t("usersCreateNew")}</option>
          {users.map((user) => (
            <option key={user.username} value={user.username}>
              {user.username}
            </option>
          ))}
        </select>
        {editing && (
          <button
            type="button"
            className={styles.linkButton}
            disabled={busy}
            onClick={() => void onDelete(editing)}
          >
            {t("usersDelete")}
          </button>
        )}
      </div>

      {!editing && (
        <input
          className={styles.input}
          value={draft.username}
          placeholder={t("usersUsernamePlaceholder")}
          autoComplete="off"
          onChange={(event) =>
            onDraftChange({ ...draft, username: event.target.value })
          }
        />
      )}
      <input
        className={styles.input}
        type="password"
        value={draft.password}
        placeholder={
          editing
            ? t("usersNewPasswordPlaceholder")
            : t("usersPasswordPlaceholder")
        }
        autoComplete="new-password"
        onChange={(event) =>
          onDraftChange({ ...draft, password: event.target.value })
        }
      />

      <p className={styles.subhead}>{t("usersProjectsHeading")}</p>
      <ul className={styles.projectList}>
        {projects.map((project) => (
          <li key={project.id} className={styles.projectRow}>
            <span className={styles.projectName} title={project.name}>
              {project.name}
            </span>
            <select
              className={styles.select}
              value={draft.access[project.id] ?? "none"}
              aria-label={project.name}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  access: {
                    ...draft.access,
                    [project.id]: event.target.value as ProjectAccessLevel,
                  },
                })
              }
            >
              <option value="none">{t("usersAccessNone")}</option>
              <option value="view">{t("usersAccessView")}</option>
              <option value="join">{t("usersAccessJoin")}</option>
              <option value="new-session">{t("usersAccessNewSession")}</option>
            </select>
          </li>
        ))}
      </ul>

      <label className={styles.field}>
        <span>{t("usersJoinOffsetLabel")}</span>
        <input
          className={styles.input}
          type="number"
          min={JOIN_STALE_OFFSET_MIN_MINUTES}
          max={JOIN_STALE_OFFSET_MAX_MINUTES}
          value={draft.joinStaleOffsetMinutes}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              joinStaleOffsetMinutes: Number(event.target.value),
            })
          }
        />
      </label>
      <p className={styles.hint}>{t("usersJoinOffsetHint")}</p>

      <p className={styles.subhead}>{t("usersLockHeading")}</p>
      <select
        className={styles.select}
        value={draft.provider}
        aria-label={t("usersLockProvider")}
        onChange={(event) =>
          onDraftChange({ ...draft, provider: event.target.value, model: "" })
        }
      >
        <option value="">{t("usersLockUnset")}</option>
        {providers.map((provider) => (
          <option key={provider.name} value={provider.name}>
            {provider.name}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={draft.model}
        aria-label={t("usersLockModel")}
        disabled={!draft.provider}
        onChange={(event) =>
          onDraftChange({ ...draft, model: event.target.value })
        }
      >
        <option value="">{t("usersLockUnset")}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={draft.effort}
        aria-label={t("usersLockEffort")}
        onChange={(event) =>
          onDraftChange({ ...draft, effort: event.target.value })
        }
      >
        <option value="">{t("usersLockUnset")}</option>
        {EFFORT_OPTIONS.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </select>

      {error && <p className={styles.error}>{error}</p>}
      <button
        type="button"
        className={styles.submit}
        disabled={busy}
        onClick={() => void onSubmit()}
      >
        {editing ? t("usersSaveUser") : t("usersCreateUser")}
      </button>
    </div>
  );
}
