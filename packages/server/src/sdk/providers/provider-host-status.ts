let linuxProviderHostDegraded = false;

export function setLinuxProviderHostDegraded(degraded: boolean): void {
  linuxProviderHostDegraded = process.platform === "linux" && degraded;
}

export function resetLinuxProviderHostDegradedForTests(): void {
  linuxProviderHostDegraded = false;
}

/** Linux boot tried to attach or start the provider host and still has none. */
export function isLinuxProviderHostDegraded(): boolean {
  return linuxProviderHostDegraded;
}
