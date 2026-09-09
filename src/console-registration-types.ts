export interface DirectoryPreview {
  ticket: string;
  path: string;
  name: string;
  requiresAuthorization: boolean;
  expiresAt: string;
}
export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
  truncated: boolean;
}

export interface CodexSessionSummary {
  threadId: string;
  title: string;
  cwd: string;
  source: string;
  status: string;
  archived: boolean;
  updatedAt: string | null;
}

export interface ImportedSession extends CodexSessionSummary {
  id: string;
  instanceId: string;
  importedAt: string;
  usageStatus: "unavailable";
  registration: "imported";
}

export interface SessionCatalogPage {
  ticket: string;
  entries: CodexSessionSummary[];
  nextCursor: string | null;
  expiresAt: string;
}
