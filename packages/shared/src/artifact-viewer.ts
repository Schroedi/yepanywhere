export interface ArtifactViewerConfig {
  port: number;
  localOrigin?: string;
  publicOrigin?: string;
  /** Presence in status metadata enables the expiry setting on the client. */
  expiryHours?: number;
}

export interface ArtifactViewerStatus extends ArtifactViewerConfig {
  available: boolean;
  locked: boolean;
  defaultLocalOrigin: string;
}

export interface ArtifactViewerGrant {
  id: string;
  url: string;
  expiresAt: number;
}
