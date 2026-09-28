import type { LimitedUserGrants } from "@yep-anywhere/shared";
import type { ProjectAppReservation } from "./ProjectAppStore.js";

/** A limited project owner's current grant is the public-serving ceiling. */
export function projectAppPublicAllowed(
  projectOwner: string | undefined,
  reservation: ProjectAppReservation,
  activeGrants: (username: string) => LimitedUserGrants | null,
): boolean {
  const owner =
    projectOwner ??
    (reservation.owner === "superuser" ? undefined : reservation.owner);
  return owner
    ? activeGrants(owner)?.allowPublicApps === true
    : !reservation.privateOnly;
}
