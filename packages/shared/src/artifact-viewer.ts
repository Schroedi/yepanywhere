export interface ArtifactViewerConfig {
  port: number;
  localOrigin?: string;
  publicOrigin?: string;
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
