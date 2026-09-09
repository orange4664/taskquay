import { digest, type WorkLedger } from "./work-ledger.js";
import type { CodexSessionSummary, ImportedSession } from "./console-registration-types.js";
import { canonicalPathIdentity } from "./roots.js";

interface ReferenceRow {
  id: string; instance_id: string; thread_id: string; title: string; cwd: string;
  source: string; status: string; archived: number; provider_updated_at: string | null; imported_at: string;
}

export function importedSessions(ledger: WorkLedger, projectId: string): ImportedSession[] {
  const rows = ledger.db.prepare("select * from console_thread_references where project_id=? order by imported_at desc,id").all(projectId) as ReferenceRow[];
  return rows.map((row) => ({ id: row.id, instanceId: row.instance_id, threadId: row.thread_id, title: row.title,
    cwd: row.cwd, source: row.source, status: row.status, archived: row.archived === 1, updatedAt: row.provider_updated_at,
    importedAt: row.imported_at, usageStatus: "unavailable", registration: "imported" }));
}

export function importSessions(ledger: WorkLedger, projectId: string, instanceId: string, entries: CodexSessionSummary[]): number {
  return ledger.db.transaction(() => {
    const insert = ledger.db.prepare(`insert into console_thread_references
      (id,project_id,instance_id,thread_id,title,cwd,source,status,archived,provider_updated_at,imported_at)
      values (?,?,?,?,?,?,?,?,?,?,?) on conflict(project_id,instance_id,thread_id) do update set
      title=excluded.title,source=excluded.source,status=excluded.status,archived=excluded.archived,provider_updated_at=excluded.provider_updated_at`);
    const root = ledger.getProject(projectId).root;
    for (const entry of entries) {
      if (canonicalPathIdentity(entry.cwd) !== canonicalPathIdentity(root)) throw new Error("Session reference is outside the registered project.");
      insert.run(`ref_${digest([projectId, instanceId, entry.threadId]).slice(0, 32)}`, projectId, instanceId,
        entry.threadId, entry.title, root, entry.source, entry.status, entry.archived ? 1 : 0, entry.updatedAt, new Date().toISOString());
    }
    return entries.length;
  }).immediate();
}

export function removeSessionReference(ledger: WorkLedger, projectId: string, referenceId: string): void {
  ledger.db.prepare("delete from console_thread_references where project_id=? and id=?").run(projectId, referenceId);
}
