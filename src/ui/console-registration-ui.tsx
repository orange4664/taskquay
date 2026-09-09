import React, { useEffect, useRef, useState } from "react";
import { FolderOpen, Search, Download, Trash2, ArrowUp, ChevronRight } from "lucide";
import { Modal, ConsoleIcon } from "./console-modal.js";
import type { DirectoryListing, DirectoryPreview, ImportedSession, SessionCatalogPage, CodexSessionSummary } from "../console-registration-types.js";

export type ConsoleApi = <T>(path: string, body?: unknown) => Promise<T>;
const message = (error: unknown) => error instanceof Error ? error.message : "请求失败，请重试。";
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "未记录";
const statuses: Record<string, string> = { idle: "空闲", active: "活动中", notLoaded: "未加载", systemError: "异常", unknown: "未确认" };

export function FolderRegistration({ api, initialPath, close, registered }: {
  api: ConsoleApi; initialPath: string; close: () => void; registered: (id: string) => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [preview, setPreview] = useState<DirectoryPreview | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [name, setName] = useState(""); const [authorize, setAuthorize] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const action = async (run: () => Promise<void>) => { setBusy(true); setError(""); try { await run(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } };
  const show = (result: DirectoryPreview | null) => { setPreview(result); setListing(null); setAuthorize(false); if (result) { setPath(result.path); setName(result.name); } };
  const browse = (directory?: string) => action(async () => {
    const result = await api<DirectoryListing>("folders/browse", { path: directory });
    setListing(result); setPath(result.path); setPreview(null); setAuthorize(false);
  });
  return <Modal title="添加项目文件夹" close={close} locked={busy}>
    <form className="registration-form" onSubmit={(event) => { event.preventDefault(); void action(async () => show((await api<{ preview: DirectoryPreview }>("folders/preview", { path })).preview)); }}>
      <label htmlFor="project-folder-path">项目文件夹</label>
      <div className="folder-path-row"><input id="project-folder-path" value={path} maxLength={4096} placeholder="/path/to/project" disabled={busy}
        onChange={(event) => { setPath(event.target.value); setListing(null); setPreview(null); setAuthorize(false); }} required />
        <button type="button" className="icon-command" title="浏览文件夹" aria-label="浏览文件夹" disabled={busy}
          onClick={() => void browse(path || undefined)}><ConsoleIcon icon={FolderOpen} /></button>
        <button type="submit" disabled={busy || !path.trim()}>检查目录</button></div>
    </form>
    {error && <p role="alert" className="notice error">{error}</p>}
    {listing && <div className="folder-browser">
      <div className="folder-browser-heading"><button className="icon-command" title="上一级目录" aria-label="上一级目录" disabled={busy || !listing.parent} onClick={() => void browse(listing.parent!)}><ConsoleIcon icon={ArrowUp} /></button><code>{listing.path}</code></div>
      <div className="folder-browser-list">{listing.entries.length ? listing.entries.map((entry) => <button key={entry.path} aria-label={`打开文件夹 ${entry.name}`} disabled={busy} onClick={() => void browse(entry.path)}><ConsoleIcon icon={FolderOpen} /><span>{entry.name}</span><ConsoleIcon icon={ChevronRight} /></button>) : <p className="subtle">没有可见的子文件夹</p>}</div>
      {listing.truncated && <p className="subtle">此目录较大，未列出全部文件夹。可输入更具体的路径。</p>}
      <div className="dialog-actions"><button className="primary" disabled={busy} onClick={() => void action(async () => show((await api<{ preview: DirectoryPreview }>("folders/preview", { path: listing.path })).preview))}>选择此文件夹</button></div>
    </div>}
    {preview && <div className="folder-preview">
      <div className="selection-path"><ConsoleIcon icon={FolderOpen} /><code>{preview.path}</code></div>
      <label htmlFor="project-display-name">项目名称</label><input id="project-display-name" value={name} maxLength={200} disabled={busy} onChange={(event) => setName(event.target.value)} />
      {preview.requiresAuthorization ? <label className="check-label access-confirm"><input type="checkbox" checked={authorize} disabled={busy} onChange={(event) => setAuthorize(event.target.checked)} />
        允许已授权的工具访问这个文件夹及其子目录</label> : <p className="registration-status">此文件夹已在授权范围内</p>}
      <div className="dialog-actions"><button onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy || !name.trim() || (preview.requiresAuthorization && !authorize)}
        onClick={() => void action(async () => { const result = await api<{ project: { id: string } }>("folders/register", { ticket: preview.ticket, name, authorize }); registered(result.project.id); })}>
        {busy ? "正在登记…" : preview.requiresAuthorization ? "授权并登记" : "登记文件夹"}</button></div>
    </div>}
    {busy && !preview && <p role="status" className="subtle">正在等待目录选择或检查…</p>}
  </Modal>;
}

export function SessionRegistration({ api, projectId, projectRoot, close, registered }: {
  api: ConsoleApi; projectId: string; projectRoot: string; close: () => void; registered: () => void;
}) {
  const [archived, setArchived] = useState(false); const [search, setSearch] = useState(""); const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState<SessionCatalogPage | null>(null); const [entries, setEntries] = useState<CodexSessionSummary[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = async (more = false) => {
    const turn = ++sequence.current;
    setBusy(true); setError("");
    if (!more) { setSelection(new Set()); setEntries([]); setPage(null); setActiveSearch(search); }
    try {
      const result = await api<SessionCatalogPage>(`projects/${encodeURIComponent(projectId)}/session-catalog`, {
        archived, search: more ? activeSearch : search, ...(more && page ? { ticket: page.ticket, cursor: page.nextCursor } : {}),
      });
      if (turn !== sequence.current) return;
      setPage(result); setEntries((previous) => [...new Map([...(more ? previous : []), ...result.entries].map((entry) => [entry.threadId, entry])).values()]);
    } catch (cause) { if (turn === sequence.current) setError(message(cause)); }
    finally { if (turn === sequence.current) setBusy(false); }
  };
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [archived, projectId]);
  const submit = async () => {
    if (!page || !selection.size) return;
    setBusy(true); setError("");
    try { await api(`projects/${encodeURIComponent(projectId)}/session-imports`, { ticket: page.ticket, threadIds: [...selection] }); registered(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  return <Modal title="登记已有 Codex 会话" close={close} locked={busy}>
    <div className="selection-path"><ConsoleIcon icon={FolderOpen} /><code>{projectRoot}</code></div>
    <form className="catalog-filters" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label className="catalog-search"><span className="sr-only">搜索会话</span><input value={search} maxLength={120} placeholder="搜索会话" disabled={busy} onChange={(event) => setSearch(event.target.value)} /></label>
      <button type="submit" className="icon-command" title="搜索会话" aria-label="搜索会话" disabled={busy}><ConsoleIcon icon={Search} /></button>
      <label className="sr-only" htmlFor="catalog-archived">归档状态</label><select id="catalog-archived" value={String(archived)} disabled={busy} onChange={(event) => setArchived(event.target.value === "true")}><option value="false">未归档</option><option value="true">已归档</option></select>
    </form>
    {error && <p role="alert" className="notice error">{error}</p>}
    <div className="catalog-list" aria-busy={busy}>
      {!entries.length ? <div className="empty"><h3>{busy ? "正在读取会话…" : "未找到匹配会话"}</h3>{!busy && <p>可更换文件夹、搜索词或归档状态。</p>}</div> : entries.map((entry) => <label className={`catalog-row ${selection.has(entry.threadId) ? "selected" : ""}`} key={entry.threadId}>
        <input type="checkbox" aria-label={`登记 ${entry.title}`} checked={selection.has(entry.threadId)} disabled={busy || (!selection.has(entry.threadId) && selection.size >= 50)}
          onChange={(event) => setSelection((previous) => { const next = new Set(previous); event.target.checked ? next.add(entry.threadId) : next.delete(entry.threadId); return next; })} />
        <span className="catalog-title"><strong>{entry.title}</strong><code>{entry.threadId}</code><small>{entry.source} · {date(entry.updatedAt)}</small></span>
        <span className="catalog-state">{entry.archived ? "已归档" : statuses[entry.status] ?? entry.status}</span>
      </label>)}
    </div>
    {page?.nextCursor && <button className="load-more" disabled={busy} onClick={() => void load(true)}>加载更多</button>}
    <div className="import-summary"><span>已选择 {selection.size} 个会话</span><span>历史用量不计入任务账本</span></div>
    <div className="dialog-actions"><button onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy || !selection.size} onClick={() => void submit()}><ConsoleIcon icon={Download} />{busy ? "正在核对…" : `登记 ${selection.size} 个会话`}</button></div>
  </Modal>;
}

export function ImportedSessions({ entries, busy, canManage, remove }: {
  entries: ImportedSession[]; busy: boolean; canManage: boolean; remove: (id: string) => void;
}) {
  return <section className="imported-sessions"><div className="panel-title"><h2>手动登记的会话</h2><span>{entries.length} 个</span></div>
    {!entries.length ? <div className="empty"><h3>尚未登记已有会话</h3></div> : <div className="imported-list">{entries.map((entry) => <article className="imported-row" key={entry.id}>
      <div><strong className="thread-title">{entry.title}</strong><div className="source-line">手动登记 · {entry.source} · 历史用量未知</div><code>{entry.threadId}</code></div>
      <div className="imported-status"><span className="badge">{entry.archived ? "已归档" : statuses[entry.status] ?? entry.status}</span><small>{date(entry.updatedAt)}</small></div>
      {canManage && <button className="icon-command" title="移除登记，保留原会话" aria-label={`移除登记 ${entry.title}`} disabled={busy} onClick={() => remove(entry.id)}><ConsoleIcon icon={Trash2} /></button>}
    </article>)}</div>}
  </section>;
}
