import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FolderPlus, Download, RefreshCw, Layers2, LogOut, X, ListTodo, MessagesSquare, ChartNoAxesColumn, CircleAlert, Folder, Archive, ArchiveRestore, ShieldCheck, ChevronRight, LockKeyhole } from "lucide";
import { Modal, ConsoleIcon } from "./console-modal.js";
import { FolderRegistration, SessionRegistration, ImportedSessions } from "./console-registration-ui.js";
import type { ImportedSession } from "../console-registration-types.js";
import "@fontsource-variable/geist";
import "./console.css";
import "./console-registration.css";

type Quality = "complete" | "partial" | "unavailable" | "not_used";
type Counts = { totalTokens: number; inputTokens: number; outputTokens: number; cachedInputTokens?: number; reasoningOutputTokens?: number; cacheWriteInputTokens?: number };
type Origin = { entryPoint: string; modelLabel?: string; clientLabel?: string; evidence?: string };
interface Usage { usageStatus: Quality; codexUsage: Counts | null; missingExecutions: number; executions: number; pendingExecutions: number }
interface Receipt extends Usage { workRunId: string; projectId: string; title: string; executionStatus: string; acceptanceStatus: string; origin: Origin;
  codexThreads: number; receiptRevision: number; createdAt?: string; finishedAt?: string }
interface Project extends Usage { id: string; name: string; root: string; taskCount: number; activeTasks: number; pendingAcceptance: number; needsAttention: number }
interface Thread { id: string; title: string; agentId: string; origin: Origin; createdHere: boolean; identityVerified: boolean;
  externalActivity: boolean; protected: boolean; archiveState: string; nameStatus: string; updatedAt: string; runs: { id: string; status: string; acceptance: string }[] }
interface Batch { batchId: string; projectId: string; mode: "archive" | "restore"; status: string; confirmationHash: string; expiresAt: string;
  acceptPartial: boolean; readyCount: number; succeededCount: number; entries: { managedThreadId: string; title: string; status: string; reason: string | null }[] }
type Detail = Receipt & { summary: string; evidence: { label: string; reference: string; outcome: string }[];
  operations: { id: string; kind: string; label: string; status: string; created_at: string }[];
  turns: { executionId: string; agentId: string; status: string; codexUsage: Counts | null; usageStatus: Quality; boundary: string; requestedModel: string | null; requestedEffort: string | null }[] };
const sourceLabels: Record<string, string> = { chatgpt_mcp: "ChatGPT → DevSpace", other_mcp: "MCP 主控 → DevSpace", devspace_cli: "DevSpace CLI", console: "管理台", legacy_unknown: "历史来源待确认" };
const states: Record<string, string> = { running: "执行中", queued: "排队中", completed: "执行完成", failed: "失败", cancelled: "已取消", reconciliation_required: "待核对",
  passed: "验收通过", pending: "待验收", not_applicable: "无需验收", active: "未归档", archived: "已归档", unknown: "状态未知",
  archiving: "归档中", restoring: "恢复中", planned: "待确认", executing: "处理中", succeeded: "成功", partial: "部分完成", ready: "可执行", skipped: "已跳过" };
const qualities: Record<Quality, string> = { complete: "统计完整", partial: "部分已记录", unavailable: "用量未知", not_used: "未调用 Codex" };
const reasons: Record<string, string> = {
  preview_budget_exhausted: "本次预览时间预算已用完，请缩小所选批次后重新预览",
  unproven_creation: "无法证明由 DevSpace 创建", unverified_provider_instance: "提供方实例未确认", external_turns_detected: "存在外部续写",
  user_protected: "已设为保留", archive_state_ineligible: "当前归档状态不符合条件", managed_agent_active: "代理仍在执行或排队",
  open_or_unaccepted_work: "关联任务未关闭或未验收", usage_incomplete: "用量尚有缺口", active_execution_claim: "还有执行占用",
  not_archived_by_devspace: "没有本系统归档成功的回执", provider_instance_changed: "Codex 账号或实例已变化",
  incomplete_descendant_inventory: "无法完整核查后代会话", provider_project_mismatch: "提供方项目不匹配", provider_thread_active_or_unknown: "提供方仍活动或状态未知",
  unarchived_descendants_require_review: "存在未归档后代，需单独核查", external_or_unmapped_turns: "发现未纳管执行，已保护",
  provider_archive_state_changed: "Codex 中的状态已变化", provider_state_unavailable: "无法读取提供方状态", managed_state_changed_since_preview: "预览后的任务状态已变化",
  provider_state_changed_since_preview: "预览后的会话内容或状态已变化", provider_acknowledgement_or_verification_missing: "请求结果待核对，不会盲目重发",
  unknown_prior_side_effect_not_replayed: "此前操作结果不确定，需要继续核对", externally_changed_or_protected: "外部修改或用户保护", unproven_creation_or_instance: "创建或实例归属不足",
};
const n = (value: number | undefined | null) => value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const label = (value: string) => states[value] ?? value;

function Badge({ value, children }: { value: string; children?: React.ReactNode }) {
  return <span className={`badge badge-${value}`}>{children ?? label(value)}</span>;
}
function TokenValue({ usage, compact = false }: { usage: Usage; compact?: boolean }) {
  return <span className={compact ? "token compact" : "token"}><strong>{n(usage.codexUsage?.totalTokens)}</strong>{!compact && <small>Token</small>}
    <span className={`quality ${usage.usageStatus}`}>{qualities[usage.usageStatus]}</span></span>;
}
function ConsoleApp() {
  const [csrf, setCsrf] = useState<string | null>(null);
  const [boot, setBoot] = useState(true); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(new URLSearchParams(location.search).get("project") ?? "");
  const [tab, setTab] = useState("tasks"); const [source, setSource] = useState(""); const [status, setStatus] = useState(""); const [range, setRange] = useState("all");
  const [runs, setRuns] = useState<Receipt[]>([]); const [offset, setOffset] = useState<number | null>(null); const [stats, setStats] = useState<Project | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]); const [selection, setSelection] = useState<Set<string>>(new Set());
  const [imports, setImports] = useState<ImportedSession[]>([]);
  const [localRegistration, setLocalRegistration] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false); const [sessionDialog, setSessionDialog] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null); const [batch, setBatch] = useState<Batch | null>(null);
  const [history, setHistory] = useState<{ id: string; mode: string; status: string; created_at: string }[]>([]);
  const [attention, setAttention] = useState<{ claims: any[]; waiters: any[] }>({ claims: [], waiters: [] });
  const [acceptPartial, setAcceptPartial] = useState(false); const [externalIdle, setExternalIdle] = useState(false);
  const [updated, setUpdated] = useState<string>(); const epoch = useRef(0);
  const initialRun = useRef(new URLSearchParams(location.search).get("run"));
  const project = projects.find((entry) => entry.id === projectId);
  const api = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`/console/api/${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      cache: "no-store", headers: body === undefined ? {} : { "Content-Type": "application/json", ...(csrf ? { "X-DevSpace-CSRF": csrf } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 401) { setCsrf(null); throw new Error(path === "login" ? "授权口令不正确。" : "会话已过期，请重新登录。"); }
    const result = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
    if (!response.ok) throw new Error(result.message ?? (response.status === 429 ? "操作过于频繁，请稍后再试。" : "请求未通过校验，状态尚未改变。"));
    return result;
  }, [csrf]);
  useEffect(() => { void api("session").then((result) => { setCsrf(result.csrf); setLocalRegistration(result.localRegistration === true); }).catch(() => {}).finally(() => setBoot(false)); }, []);
  const query = () => {
    const params = new URLSearchParams(); if (source) params.set("source", source); if (status) params.set("status", status);
    if (range !== "all") params.set("after", new Date(Date.now() - Number(range) * 86400000).toISOString());
    return params;
  };
  const refresh = useCallback(async () => {
    if (!csrf) return;
    const turn = ++epoch.current;
    try {
      const list = await api("projects"); if (turn !== epoch.current) return;
      setProjects(list.projects);
      const id = list.projects.some((entry: Project) => entry.id === projectId) ? projectId : list.projects[0]?.id;
      if (!id) { setUpdated(new Date().toISOString()); return; }
      if (id !== projectId) { setProjectId(id); return; }
      const root = `projects/${encodeURIComponent(id)}`;
      const tasks = await api(`${root}/runs?${query()}`); if (turn !== epoch.current) return;
      setRuns(tasks.entries); setOffset(tasks.nextOffset); setStats(tasks.stats);
      if (tab === "sessions") {
        const [sessions, batches] = await Promise.all([api(`${root}/threads`), api(`${root}/archive`)]);
        if (turn !== epoch.current) return; setThreads(sessions.threads); setImports(sessions.imports ?? []); setHistory(batches.batches);
      }
      if (tab === "attention") { const next = await api(`${root}/attention`); if (turn === epoch.current) setAttention(next); }
      setUpdated(new Date().toISOString());
    } catch (cause) { if (turn === epoch.current) setError(cause instanceof Error ? cause.message : "读取失败"); }
  }, [api, csrf, projectId, tab, source, status, range]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden && !busy && !batch && !detail && !folderDialog && !sessionDialog) void refresh(); }, 5000);
    return () => { clearInterval(timer); epoch.current++; }; }, [refresh, busy, batch, detail, folderDialog, sessionDialog]);
  useEffect(() => { setSelection(new Set()); setDetail(null); setBatch(null); setSessionDialog(false); setImports([]); setThreads([]); }, [projectId]);
  const act = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); } finally { setBusy(false); } };
  const openDetail = (runId: string) => act(async () => setDetail(await api(`projects/${projectId}/runs/${runId}`)));
  useEffect(() => {
    if (!csrf || !projectId || !initialRun.current) return;
    const runId = initialRun.current; initialRun.current = null;
    void act(async () => setDetail(await api(`projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`)));
  }, [csrf, projectId]);
  const preview = (mode: "archive" | "restore") => act(async () => {
    setExternalIdle(false); setBatch(await api(`projects/${projectId}/archive/preview`, { mode, acceptPartial,
      ...(selection.size ? { threadKeys: [...selection] } : {}) }));
  });
  const execute = () => act(async () => {
    if (!batch || !externalIdle) return;
    let result = batch;
    do {
      result = await api(`projects/${projectId}/archive/${result.batchId}/execute`, { confirmationHash: result.confirmationHash, externalIdle: true });
      setBatch(result);
    } while (result.status === "executing" && result.readyCount > 0);
    setMessage(result.status === "reconciliation_required" ? "部分结果需要核对，未盲目重试。批次记录已保存。" : "批次执行结果已保存，任务和用量历史保持不变。");
    await refresh();
  });

  if (boot) return <main className="boot" aria-busy="true"><ConsoleIcon icon={Layers2} /><span>正在连接 TaskQuay…</span></main>;
  if (!csrf) return <main className="login-page"><section className="login-card">
    <div className="brand-mark"><ConsoleIcon icon={Layers2} /></div><h1>TaskQuay</h1>
    <p className="lead">登录项目任务台</p>
    <form onSubmit={(event) => { event.preventDefault(); void act(async () => { const result = await api("login", { password }); setPassword(""); setCsrf(result.csrf); setLocalRegistration(result.localRegistration === true); }); }}>
      <label htmlFor="owner-password">授权口令</label><input id="owner-password" aria-label="DevSpace 授权口令" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={2048} />
      {error && <p className="notice error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? "正在验证…" : "进入任务台"}<ConsoleIcon icon={ChevronRight} /></button>
    </form>
  </section><div className="login-caption"><ConsoleIcon icon={LockKeyhole} />本机管理访问</div></main>;

  return <div className="console-shell">
    <aside className="sidebar"><a className="brand" href="/console/"><span className="brand-mark small"><ConsoleIcon icon={Layers2} /></span><span>TaskQuay<small>项目任务台</small></span></a>
      <div className="sidebar-heading">项目 <span>{projects.length}</span></div>
      {localRegistration && <button className="add-project" onClick={() => setFolderDialog(true)} disabled={busy}><ConsoleIcon icon={FolderPlus} />添加文件夹</button>}
      <nav aria-label="项目选择">{projects.map((entry) => <button key={entry.id} className={`project-button ${entry.id === projectId ? "selected" : ""}`} aria-current={entry.id === projectId ? "page" : undefined} onClick={() => setProjectId(entry.id)} disabled={busy}>
        <ConsoleIcon icon={Folder} /><span className="project-name">{entry.name}<small>{entry.taskCount} 项任务 · {entry.activeTasks} 项进行中</small></span>{entry.activeTasks > 0 && <i className="live-dot" />}
      </button>)}</nav>
      <div className="sidebar-bottom"><span className="online-dot" /> 管理会话已连接</div>
    </aside>
    <main className="main-content"><header className="page-header"><div><p className="eyebrow">项目工作区</p><h1>{project?.name ?? "项目任务台"}</h1>{project && <p className="path" title={project.root}>{project.root}</p>}</div>
      <div className="header-actions"><span className="updated">{updated ? `${date(updated)} 更新` : "读取中"}</span><button className={`icon-command ${refreshing ? "is-refreshing" : ""}`} aria-label="刷新" title="刷新" onClick={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)); }} disabled={busy || refreshing}><ConsoleIcon icon={RefreshCw} /></button><button className="icon-command" aria-label="退出登录" title="退出登录" onClick={() => void act(async () => { await api("logout", {}); setCsrf(null); })} disabled={busy}><ConsoleIcon icon={LogOut} /></button></div></header>
      {error && <div role="alert" className="notice error"><span>{error}</span><button className="icon-command" aria-label="关闭提示" title="关闭提示" onClick={() => setError("")}><ConsoleIcon icon={X} /></button></div>}
      {message && <div role="status" className="notice success"><span>{message}</span><button className="icon-command" aria-label="关闭提示" title="关闭提示" onClick={() => setMessage("")}><ConsoleIcon icon={X} /></button></div>}
      {!project ? <section className="empty big"><ConsoleIcon icon={FolderPlus} /><h2>还没有登记的项目</h2>{localRegistration && <button className="primary" onClick={() => setFolderDialog(true)}><ConsoleIcon icon={FolderPlus} />添加文件夹</button>}</section> : <>
      <section className="metric-grid" aria-label="项目统计"><article className="metric accent"><span>已记录的 Codex 消耗</span>{stats ? <TokenValue usage={stats} /> : <strong>—</strong>}<small>按任务开始时间统计 · 不等于订阅账单</small></article>
        <article className="metric"><span>进行中的任务</span><strong>{stats?.activeTasks ?? 0}<small> / {stats?.taskCount ?? 0}</small></strong><small>全部 {stats?.taskCount ?? 0} 项任务</small></article>
        <article className="metric"><span>等待验收</span><strong>{stats?.pendingAcceptance ?? 0}</strong><small>待确认执行结果</small></article>
        <article className="metric"><span>需要关注</span><strong>{stats?.needsAttention ?? 0}</strong><small>失败或待核对</small></article></section>
      <nav className="tabs" aria-label="项目页面">{[{ value: "tasks", text: "任务", icon: ListTodo }, { value: "sessions", text: "Codex 会话", icon: MessagesSquare }, { value: "usage", text: "用量", icon: ChartNoAxesColumn }, { value: "attention", text: "需处理项", icon: CircleAlert }].map(({ value, text, icon }) =>
        <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)} disabled={busy} aria-current={tab === value ? "page" : undefined}><ConsoleIcon icon={icon} />{text}</button>)}</nav>
      <div className="view-content" key={`${projectId}:${tab}`}>
      {(tab === "tasks" || tab === "usage") && <>
        <div className="toolbar"><div className="filters"><label>来源<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option>{Object.entries(sourceLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{["running", "completed", "failed", "cancelled", "reconciliation_required"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label>开始时间<select value={range} onChange={(event) => setRange(event.target.value)}><option value="all">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option></select></label></div><span className="subtle">缓存与推理明细不重复计入总量</span></div>
        {tab === "usage" && <section className="usage-explainer"><h2>看总消耗，也看统计边界</h2><p>完整：受管执行与用量边界齐全。部分：有已记录值，但仍有缺口。未知：没有足够证据，不能写成零。未调用：确认没有发起 Codex 推理。</p>
          <dl><div><dt>输入</dt><dd>{n(stats?.codexUsage?.inputTokens)}</dd></div><div><dt>其中缓存读取</dt><dd>{n(stats?.codexUsage?.cachedInputTokens)}</dd></div><div><dt>输出</dt><dd>{n(stats?.codexUsage?.outputTokens)}</dd></div><div><dt>缺少完整用量的执行</dt><dd>{n(stats?.missingExecutions)}</dd></div></dl></section>}
        <section className="table-panel"><div className="panel-title"><h2>{tab === "usage" ? "逐任务用量" : "项目任务"}</h2><span>{runs.length} 项{offset !== null ? "已加载" : ""}</span></div>
          {!runs.length ? <div className="empty"><h3>没有符合条件的任务</h3><p>调整筛选条件，或开始一项新的工作。</p></div> : <div className="table-scroll"><table className="tasks-table"><thead><tr><th>任务 / 来源</th><th>执行与验收</th><th>Codex Token</th><th>会话</th><th>开始时间</th></tr></thead><tbody>{runs.map((run) => <tr key={run.workRunId}>
            <td><button className="task-title" onClick={() => void openDetail(run.workRunId)}>{run.title}</button><div className="source-line">{sourceLabels[run.origin.entryPoint] ?? run.origin.entryPoint}{run.origin.modelLabel && <span> · {run.origin.modelLabel}（标签）</span>}</div></td>
            <td><div className="state-stack"><Badge value={run.executionStatus} /><Badge value={run.acceptanceStatus} /></div></td><td><TokenValue usage={run} compact /></td><td>{run.codexThreads}</td><td className="date">{date(run.createdAt)}</td></tr>)}</tbody></table></div>}
          {offset !== null && <button className="load-more" disabled={busy} onClick={() => void act(async () => { const params = query(); params.set("offset", String(offset)); const more = await api(`projects/${projectId}/runs?${params}`); setRuns((current) => [...current, ...more.entries]); setOffset(more.nextOffset); })}>加载更多</button>}
        </section></>}
      {tab === "sessions" && <>
        <div className="registration-toolbar"><h2>项目会话</h2>{localRegistration && <button className="primary" onClick={() => setSessionDialog(true)} disabled={busy}><ConsoleIcon icon={Download} />登记已有会话</button>}</div>
        <ImportedSessions entries={imports} busy={busy} canManage={localRegistration} remove={(id) => void act(async () => {
          await api(`projects/${encodeURIComponent(projectId)}/session-imports/${encodeURIComponent(id)}/remove`, {}); setMessage("已移除登记，原会话保持不变。"); await refresh();
        })} />
        <div className="session-note"><ConsoleIcon icon={ShieldCheck} /><div><strong>受管会话归档</strong><p>归档隐藏原聊天，保留任务与用量，不停止进程。外部续写、未验收或归属不明的会话将跳过。</p></div></div>
        <div className="toolbar session-toolbar"><label className="check-label"><input type="checkbox" checked={acceptPartial} onChange={(event) => setAcceptPartial(event.target.checked)} />预览时允许保留不完整用量回执</label><div className="button-row"><button onClick={() => void preview("restore")} disabled={busy}><ConsoleIcon icon={ArchiveRestore} />恢复已归档会话</button><button onClick={() => void preview("archive")} disabled={busy}><ConsoleIcon icon={Archive} />{selection.size ? `预览归档 ${selection.size} 个会话` : "预览项目归档"}</button></div></div>
        <section className="table-panel"><div className="panel-title"><h2>受管 Codex 会话</h2><span>{threads.length} 个</span></div>{!threads.length ? <div className="empty"><ConsoleIcon icon={MessagesSquare} /><h3>没有受管 Codex 会话</h3></div> : <div className="table-scroll"><table><thead><tr><th><span className="sr-only">选择</span></th><th>会话 / 归属</th><th>来源可信度</th><th>归档状态</th><th>保留</th></tr></thead><tbody>{threads.map((thread) => <tr key={thread.id}>
          <td><input type="checkbox" aria-label={`选择 ${thread.title}`} checked={selection.has(thread.id)} onChange={(event) => setSelection((current) => { const next = new Set(current); event.target.checked ? next.add(thread.id) : next.delete(thread.id); return next; })} /></td>
          <td><strong className="thread-title">{thread.title}</strong><div className="source-line">{sourceLabels[thread.origin.entryPoint] ?? "来源待确认"} · {thread.runs.length} 个工作执行</div><code>{thread.agentId}</code></td>
          <td>{thread.externalActivity ? <Badge value="reconciliation_required">外部续写</Badge> : <Badge value={thread.createdHere && thread.identityVerified ? "passed" : "pending"}>{thread.createdHere && thread.identityVerified ? "已登记创建" : "关联待核实"}</Badge>}</td>
          <td><Badge value={thread.archiveState} /></td><td><button className={thread.protected ? "protect active" : "protect"} onClick={() => void act(async () => { await api(`projects/${projectId}/threads/${thread.id}/protect`, { protected: !thread.protected }); await refresh(); })} disabled={busy}>{thread.protected ? "已保留" : "设为保留"}</button></td></tr>)}</tbody></table></div>}</section>
        <section className="history-panel"><h2>归档与恢复批次</h2>{!history.length ? <p className="subtle">尚无批次。预览和确认会留存独立记录。</p> : history.map((entry) => <button className="history-row" key={entry.id} onClick={() => void act(async () => { setExternalIdle(false); setBatch(await api(`projects/${projectId}/archive/${entry.id}`)); })}><span>{entry.mode === "archive" ? "归档" : "恢复"} · {date(entry.created_at)}</span><Badge value={entry.status} /><span>查看回执 →</span></button>)}</section>
      </>}
      {tab === "attention" && <section className="table-panel"><div className="panel-title"><h2>执行占用与等待</h2><span>只展示证据，不自动杀进程</span></div><div className="attention-content"><p>进程存在、模型线程空闲、任务完成是不同状态。中断遗留占用需要核对，不能通过归档聊天来“清理”。</p>
        {!attention.claims.length && !attention.waiters.length ? <div className="empty"><h3>当前没有登记的占用或等待</h3><p>这不等于已扫描并确认所有外部 Codex 客户端都已停止。</p></div> : [...attention.claims, ...attention.waiters].map((entry) => <div className="claim" key={entry.id}><strong>{entry.kind ?? "queued"}</strong><code>{entry.agent_id ?? entry.id}</code><span>{entry.access_mode} · {entry.owner_pid ? `PID ${entry.owner_pid}` : "尚未调用模型"}</span></div>)}</div></section>}
      </div></>}
      <footer className="page-footer"><span>TaskQuay</span><span>项目与会话管理</span></footer>
    </main>
    {folderDialog && <FolderRegistration api={api} initialPath={project?.root ?? ""} close={() => setFolderDialog(false)} registered={(id) => {
      setFolderDialog(false); setProjectId(id); setTab("sessions"); setMessage("项目文件夹已登记。"); void refresh();
    }} />}
    {sessionDialog && project && <SessionRegistration api={api} projectId={projectId} projectRoot={project.root} close={() => setSessionDialog(false)} registered={() => {
      setSessionDialog(false); setMessage("所选会话已登记，原会话和历史用量保持不变。"); void refresh();
    }} />}
    {detail && <Modal title="任务详情与完成回执" close={() => setDetail(null)}><p className="eyebrow">{sourceLabels[detail.origin.entryPoint]}</p><h3 className="detail-title">{detail.title}</h3><div className="button-row"><Badge value={detail.executionStatus} /><Badge value={detail.acceptanceStatus} /></div>
      <div className="detail-usage"><TokenValue usage={detail} /><p>回执版本 {detail.receiptRevision} · {detail.missingExecutions} 个执行存在用量缺口</p></div><p>{detail.summary || "工作尚未提交最终验收摘要。"}</p>
      <h3>验收证据</h3>{detail.evidence.length ? detail.evidence.map((entry, index) => <div className="evidence" key={index}><Badge value={entry.outcome} /><strong>{entry.label}</strong><code>{entry.reference}</code></div>) : <p className="subtle">尚无最终验收证据，不将模型回复自动视为通过。</p>}
      <h3>Codex 执行</h3>{detail.turns.length ? detail.turns.map((turn) => <div className="execution" key={turn.executionId}><div><code>{turn.agentId}</code><Badge value={turn.status} /></div><span>{turn.requestedModel ?? "模型未记录"} · {turn.requestedEffort ?? "推理档位未记录"}</span><strong>{n(turn.codexUsage?.totalTokens)} Token · {qualities[turn.usageStatus]}</strong><small>{turn.boundary}</small></div>) : <p className="subtle">没有 Codex 执行记录；主控和本地工具可以独立完成任务。</p>}
      <h3>工具与验证操作</h3>{detail.operations.map((entry) => <div className="operation" key={entry.id}><span>{entry.label}</span><Badge value={entry.status} /></div>)}<p className="privacy-note">这里只展示任务摘要与证据引用，不复制私人聊天全文或隐藏推理。模型名称标签不作为可信来源证明。</p>
    </Modal>}
    {batch && <Modal title={batch.mode === "archive" ? "确认项目会话归档" : "确认恢复 Codex 会话"} close={() => setBatch(null)} locked={busy}>
      <p className="lead">{batch.readyCount} 个可执行 · {batch.succeededCount} 个已成功</p><p className="subtle">范围已冻结，确认后新创建的会话不会被加入。本操作不删除聊天、任务或用量历史。</p>
      <div className="batch-entries">{batch.entries.length ? batch.entries.map((entry) => <div className="batch-entry" key={entry.managedThreadId}><strong>{entry.title}</strong><Badge value={entry.status} />{entry.reason && <p>{reasons[entry.reason] ?? entry.reason}</p>}</div>) : <div className="empty">没有可选会话</div>}</div>
      <label className="check-label external-confirm"><input type="checkbox" checked={externalIdle} onChange={(event) => setExternalIdle(event.target.checked)} disabled={busy} />我已暂停此项目其他 Codex 客户端中的操作，确认只处理上述清单。</label>
      <p className="privacy-note">DevSpace 无法锁住独立的外部客户端；状态不明、外部续写或后代关系无法核实时仍会跳过。归档不代表后台任务已停止。</p>
      <button className="primary full-width" disabled={busy || !externalIdle || (!batch.readyCount && batch.status !== "reconciliation_required")} onClick={() => void execute()}>{busy ? "正在逐项核对与执行…" : batch.status === "reconciliation_required" ? "核对上次执行结果（不盲目重放）" : `确认${batch.mode === "archive" ? "归档" : "恢复"}`}</button>
    </Modal>}
  </div>;
}

const root = document.getElementById("root"); if (root) createRoot(root).render(<ConsoleApp />);
