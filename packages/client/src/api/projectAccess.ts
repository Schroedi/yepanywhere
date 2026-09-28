import type {
  ProjectAccessEntry,
  ProjectAccessLevel,
} from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

const path = (id: string) => `/projects/${encodeURIComponent(id)}/access`;

/** Sharing one project with limited users: topics/limited-users.md. */
export const projectAccessApi = {
  list: (projectId: string) =>
    fetchJSON<{ users: ProjectAccessEntry[] }>(path(projectId)),
  set: (projectId: string, username: string, level: ProjectAccessLevel) =>
    fetchJSON<{ username: string; level: ProjectAccessLevel }>(
      path(projectId),
      { method: "PUT", body: JSON.stringify({ username, level }) },
    ),
};
