import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FolderPlus, Download, RefreshCw, Layers2, LogOut, X, ListTodo, MessagesSquare, ChartNoAxesColumn, CircleAlert, Folder, Archive, ArchiveRestore, ShieldCheck, ChevronRight, LockKeyhole, BookOpen, Search } from "lucide";
import { Modal, ConsoleIcon } from "./console-modal.js";
import { FolderRegistration, SessionRegistration, ImportedSessions } from "./console-registration-ui.js";
import { ConnectionGuide } from "./console-connection-ui.js";
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
const sourceLabels: Record<string, string> = { chatgpt_mcp: "ChatGPT → TaskQuay", other_mcp: "MCP 客户端 → TaskQuay", devspace_cli: "DevSpace CLI", console: "任务台", legacy_unknown: "历史来源待确认" };
const states: Record<string, string> = { running: "执行中", queued: "排队中", completed: "执行完成", failed: "失败", cancelled: "已取消", reconciliation_required: "待核对",
  passed: "验收通过", pending: "待验收", not_applicable: "无需验收", active: "未归档", archived: "已归档", unknown: "状态未知",
  archiving: "归档中", restoring: "恢复中", planned: "待确认", executing: "处理中", succeeded: "成功", partial: "部分完成", ready: "可执行", skipped: "已跳过" };
const qualities: Record<Quality, string> = { complete: "统计完整", partial: "部分已记录", unavailable: "用量未知", not_used: "未调用 Codex" };
const reasons: Record<string, string> = {
  preview_budget_exhausted: "预览超时，请减少所选会话后重试",
  unproven_creation: "无法确认由 TaskQuay 创建", unverified_provider_instance: "无法确认 Codex 实例", external_turns_detected: "存在外部续写",
  user_protected: "已设为保留", archive_state_ineligible: "当前归档状态不符合操作条件", managed_agent_active: "代理仍在执行或排队",
  open_or_unaccepted_work: "关联任务未关闭或未验收", usage_incomplete: "用量记录不完整", active_execution_claim: "还有执行占用",
  not_archived_by_devspace: "没有 TaskQuay 的成功归档记录", provider_instance_changed: "Codex 账号或实例已变化",
  incomplete_descendant_inventory: "无法查全所有派生会话", provider_project_mismatch: "Codex 中的项目与当前项目不一致", provider_thread_active_or_unknown: "Codex 会话仍在运行或状态未知",
  unarchived_descendants_require_review: "有尚未归档的派生会话，需要单独检查", external_or_unmapped_turns: "发现外部或无法关联的执行记录，已保护此会话",
  provider_archive_state_changed: "Codex 中的状态已变化", provider_state_unavailable: "无法读取 Codex 状态", managed_state_changed_since_preview: "任务状态已在预览后发生变化",
  provider_state_changed_since_preview: "会话内容或状态已在预览后发生变化", provider_acknowledgement_or_verification_missing: "请求结果待核对，暂不重发",
  unknown_prior_side_effect_not_replayed: "上次操作结果不确定，请先核对", externally_changed_or_protected: "会话有外部修改，或已设为保留", unproven_creation_or_instance: "无法确认会话的创建来源或所属实例",
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
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [guide, setGuide] = useState(location.hash === "#guide");
  const [loadedKey, setLoadedKey] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const loadedPages = useRef(1);
  const refreshBusy = useRef<number | null>(null);
  const authGeneration = useRef(0);
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
  const viewKey = JSON.stringify([projectId, tab, source, status, range]);
  const viewRef = useRef(viewKey); viewRef.current = viewKey;
  const dataReady = loadedKey === viewKey;
  const visibleStats = dataReady ? stats : null;
  const resetSession = useCallback(() => {
    authGeneration.current++; epoch.current++; refreshBusy.current = null;
    setCsrf(null); setPassword(""); setProjectSearch(""); setProjectId(""); setOffset(null); setProjects([]); setProjectsLoaded(false); setLoadedKey("");
    setRuns([]); setStats(null); setThreads([]); setImports([]); setHistory([]); setSelection(new Set());
    setDetail(null); setBatch(null); setFolderDialog(false); setSessionDialog(false); setMessage("");
    setUpdated(undefined); setRefreshError(""); setAttention({ claims: [], waiters: [] });
  }, []);
  const api = useCallback(async (path: string, body?: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const generation = authGeneration.current;
    try {
      const response = await fetch(`/console/api/${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
        cache: "no-store", signal: controller.signal,
        headers: body === undefined ? {} : { "Content-Type": "application/json", ...(csrf ? { "X-DevSpace-CSRF": csrf } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (generation !== authGeneration.current) throw new Error("登录状态已变化，请重新操作。");
      if (response.status === 401) {
        resetSession();
        const message = path === "login" ? "授权口令不正确。" : "会话已过期，请重新登录。";
        if (path !== "session") setError(message);
        throw new Error(message);
      }
      const result = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
      if (!response.ok) throw new Error(result.message ?? (response.status === 429 ? "操作过于频繁，请稍后再试。" : "请求未通过校验，请刷新状态后重试。"));
      return result;
    } catch (cause) {
      if (controller.signal.aborted || cause instanceof TypeError) throw new Error(body === undefined
        ? "暂时无法连接本机服务，请确认服务已启动后重试。"
        : "连接中断，操作结果尚未确认。请刷新核对后再操作。");
      throw cause;
    } finally { clearTimeout(timer); }
  }, [csrf, resetSession]);
  useEffect(() => { void api("session").then((result) => { setCsrf(result.csrf); setLocalRegistration(result.localRegistration === true); }).catch(() => {}).finally(() => setBoot(false)); }, []);
  const query = () => {
    const params = new URLSearchParams(); if (source) params.set("source", source); if (status) params.set("status", status);
    if (range !== "all") params.set("after", new Date(Date.now() - Number(range) * 86400000).toISOString());
    return params;
  };
  const refresh = useCallback(async () => {
    if (!csrf || refreshBusy.current !== null) return;
    const turn = ++epoch.current;
    refreshBusy.current = turn;
    const current = () => turn === epoch.current && viewRef.current === viewKey;
    try {
      const list = await api("projects"); if (!current()) return;
      setProjects(list.projects); setProjectsLoaded(true);
      const id = list.projects.some((entry: Project) => entry.id === projectId) ? projectId : list.projects[0]?.id;
      if (!id) { setProjectId(""); setUpdated(new Date().toISOString()); setRefreshError(""); return; }
      if (id !== projectId) { setProjectId(id); return; }
      const root = `projects/${encodeURIComponent(id)}`;
      const entries: Receipt[] = [];
      let nextOffset: number | null = 0;
      let nextStats: Project | null = null;
      const params = query();
      for (let page = 0; page < loadedPages.current && nextOffset !== null; page++) {
        params.set("offset", String(nextOffset));
        const tasks = await api(`${root}/runs?${params}`); if (!current()) return;
        entries.push(...tasks.entries); nextOffset = tasks.nextOffset; nextStats = tasks.stats;
      }
      if (tab === "sessions") {
        const [sessions, batches] = await Promise.all([api(`${root}/threads`), api(`${root}/archive`)]);
        if (!current()) return; setThreads(sessions.threads); setImports(sessions.imports ?? []); setHistory(batches.batches);
      }
      if (tab === "attention") { const next = await api(`${root}/attention`); if (!current()) return; setAttention(next); }
      if (!current()) return;
      setRuns([...new Map(entries.map((entry) => [entry.workRunId, entry])).values()]);
      setOffset(nextOffset); setStats(nextStats); setLoadedKey(viewKey);
      setUpdated(new Date().toISOString()); setRefreshError("");
    } catch (cause) { if (current()) setRefreshError(cause instanceof Error ? cause.message : "读取失败，请重试。"); }
    finally { if (refreshBusy.current === turn) refreshBusy.current = null; }
  }, [api, csrf, viewKey, projectId, tab, source, status, range]);
  useEffect(() => {
    loadedPages.current = 1; refreshBusy.current = null; setRefreshError("");
    void refresh();
    return () => { epoch.current++; refreshBusy.current = null; };
  }, [refresh]);
  useEffect(() => {
    const autoRefresh = () => {
      if (!document.hidden && !busy && !batch && !detail && !folderDialog && !sessionDialog && !guide) void refresh();
    };
    // Large, explicitly expanded lists refresh less often and retain their window.
    const timer = setInterval(autoRefresh, Math.max(5000, loadedPages.current * 5000));
    document.addEventListener("visibilitychange", autoRefresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", autoRefresh); };
  }, [refresh, busy, batch, detail, folderDialog, sessionDialog, guide]);
  useEffect(() => {
    const changed = () => setGuide(location.hash === "#guide");
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const showGuide = () => { location.hash = "guide"; setGuide(true); };
  const chooseProject = (id: string) => {
    window.history.replaceState(null, "", `${location.pathname}${location.search}`);
    setGuide(false); setProjectId(id);
  };
  useEffect(() => { setSelection(new Set()); setDetail(null); setBatch(null); setSessionDialog(false); setImports([]); setThreads([]); }, [projectId]);
  const act = async (action: () => Promise<void>) => { setBusy(true); setError(""); epoch.current++; refreshBusy.current = null; try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); } finally { setBusy(false); } };
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
    setMessage(result.status === "reconciliation_required" ? "批次记录已保存。部分结果待核对，暂未重试。" : "批次结果已保存，任务和历史用量未改动。");
    await refresh();
  });

  if (boot) return <main className="boot" aria-busy="true"><ConsoleIcon icon={Layers2} /><span>正在连接 TaskQuay…</span></main>;
  if (!csrf) return <main className="login-page"><section className="login-card">
    <div className="brand-mark"><ConsoleIcon icon={Layers2} /></div><h1>TaskQuay</h1>
    <p className="lead">登录项目任务台</p>
    <form onSubmit={(event) => { event.preventDefault(); void act(async () => { const result = await api("login", { password }); setPassword(""); setCsrf(result.csrf); setLocalRegistration(result.localRegistration === true); }); }}>
      <label htmlFor="owner-password">登录口令</label><input id="owner-password" aria-label="登录口令" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={2048} />
      {error && <p className="notice error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? "正在验证…" : "进入任务台"}<ConsoleIcon icon={ChevronRight} /></button>
    </form>
    <details className="login-help"><summary>口令在哪里？</summary><p>使用初始化 TaskQuay 时生成的 owner 口令，OAuth 授权页也使用这个口令。口令保存在运行服务的电脑上，请向管理员获取，不要粘贴到聊天里。</p></details>
  </section><div className="login-caption"><ConsoleIcon icon={LockKeyhole} />本机登录</div></main>;

  return <div className="console-shell">
    <aside className="sidebar"><a className="brand" href="/console/"><span className="brand-mark small"><ConsoleIcon icon={Layers2} /></span><span>TaskQuay<small>项目任务台</small></span></a>
      <button className={`guide-nav ${guide ? "selected" : ""}`} aria-current={guide ? "page" : undefined} onClick={showGuide} disabled={busy}><ConsoleIcon icon={BookOpen} />接入与使用</button>
      <div className="sidebar-heading">项目 <span>{projects.length}</span></div>
      {localRegistration && <button className="add-project" onClick={() => setFolderDialog(true)} disabled={busy}><ConsoleIcon icon={FolderPlus} />添加文件夹</button>}
      {projects.length > 0 && <label className="project-search"><ConsoleIcon icon={Search} /><span className="sr-only">搜索项目</span><input type="search" value={projectSearch} placeholder="搜索项目" onChange={(event) => setProjectSearch(event.target.value)} /></label>}
      <nav aria-label="项目选择">{projects.filter((entry) => `${entry.name} ${entry.root}`.toLocaleLowerCase().includes(projectSearch.trim().toLocaleLowerCase())).map((entry) => <button key={entry.id} className={`project-button ${!guide && entry.id === projectId ? "selected" : ""}`} aria-current={!guide && entry.id === projectId ? "page" : undefined} onClick={() => chooseProject(entry.id)} disabled={busy}>
        <ConsoleIcon icon={Folder} /><span className="project-name">{entry.name}<small>{entry.taskCount} 项任务 · {entry.activeTasks} 项进行中</small></span>{entry.activeTasks > 0 && <i className="live-dot" />}
      </button>)}</nav>
      {projectSearch && !projects.some((entry) => `${entry.name} ${entry.root}`.toLocaleLowerCase().includes(projectSearch.trim().toLocaleLowerCase())) && <p className="project-search-empty">没有匹配项目。<button onClick={() => setProjectSearch("")}>清除搜索</button></p>}
      <div className="sidebar-bottom"><span className={refreshError ? "offline-dot" : "online-dot"} />{refreshError ? "本机服务暂不可用" : "已登录本机任务台"}</div>
    </aside>
    <main className="main-content"><header className="page-header"><div><p className="eyebrow">{guide ? "使用指南" : "项目工作区"}</p><h1>{guide ? "接入与使用" : project?.name ?? "项目任务台"}</h1>{project && !guide && <p className="path" title={project.root}>{project.root}</p>}</div>
      <div className="header-actions"><span className="updated">{updated ? `${date(updated)} 更新` : "读取中"}</span><button className={`icon-command ${refreshing ? "is-refreshing" : ""}`} aria-label="刷新" title="刷新" onClick={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)); }} disabled={busy || refreshing}><ConsoleIcon icon={RefreshCw} /></button><button className="icon-command" aria-label="退出登录" title="退出登录" onClick={() => void act(async () => { await api("logout", {}); resetSession(); })} disabled={busy}><ConsoleIcon icon={LogOut} /></button></div></header>
      {error && <div role="alert" className="notice error"><span>{error}</span><button className="icon-command" aria-label="关闭提示" title="关闭提示" onClick={() => setError("")}><ConsoleIcon icon={X} /></button></div>}
      {message && <div role="status" className="notice success"><span>{message}</span><button className="icon-command" aria-label="关闭提示" title="关闭提示" onClick={() => setMessage("")}><ConsoleIcon icon={X} /></button></div>}
      {refreshError && <div className="notice error" role="alert"><span>{refreshError}{dataReady ? " 当前显示上次成功读取的数据。" : ""}</span><button disabled={busy || refreshing} onClick={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)); }}>重试</button></div>}
      {guide ? <ConnectionGuide api={api} projectRoot={project?.root} canRegister={localRegistration} addFolder={() => setFolderDialog(true)} /> : !projectsLoaded ? <div className="view-loading" role="status" aria-busy={!refreshError}>{refreshError ? "尚未读取项目列表" : "正在读取项目…"}</div> : !project ? <section className="empty big"><ConsoleIcon icon={FolderPlus} /><h2>还没有登记的项目</h2><p>添加项目文件夹后，可以登记已有会话。首次使用可先查看接入教程。</p>{localRegistration && <button className="primary" onClick={() => setFolderDialog(true)}><ConsoleIcon icon={FolderPlus} />添加文件夹</button>}<button onClick={showGuide}><ConsoleIcon icon={BookOpen} />查看接入教程</button></section> : <>
      <section className="metric-grid" aria-label="项目统计"><article className="metric accent"><span>已记录的 Codex 用量</span>{visibleStats ? <TokenValue usage={visibleStats} /> : <strong>—</strong>}<small>按任务开始时间统计 · 不等于订阅账单</small></article>
        <article className="metric"><span>进行中的任务</span><strong>{visibleStats?.activeTasks ?? "—"}<small> / {visibleStats?.taskCount ?? "—"}</small></strong><small>全部 {visibleStats?.taskCount ?? "—"} 项任务</small></article>
        <article className="metric"><span>等待验收</span><strong>{visibleStats?.pendingAcceptance ?? "—"}</strong><small>待确认执行结果</small></article>
        <article className="metric"><span>需要关注</span><strong>{visibleStats?.needsAttention ?? "—"}</strong><small>失败或待核对</small></article></section>
      <nav className="tabs" aria-label="项目页面">{[{ value: "tasks", text: "任务", icon: ListTodo }, { value: "sessions", text: "Codex 会话", icon: MessagesSquare }, { value: "usage", text: "用量", icon: ChartNoAxesColumn }, { value: "attention", text: "需处理项", icon: CircleAlert }].map(({ value, text, icon }) =>
        <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)} disabled={busy} aria-current={tab === value ? "page" : undefined}><ConsoleIcon icon={icon} />{text}</button>)}</nav>
      <div className="view-content" key={`${projectId}:${tab}`}>
      {(tab === "tasks" || tab === "usage") && <div className="toolbar"><div className="filters"><label>来源<select aria-label="来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option>{Object.entries(sourceLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <label>状态<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{["running", "completed", "failed", "cancelled", "reconciliation_required"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label>开始时间<select aria-label="开始时间" value={range} onChange={(event) => setRange(event.target.value)}><option value="all">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option></select></label>{(source || status || range !== "all") && <button className="filter-reset" onClick={() => { setSource(""); setStatus(""); setRange("all"); }}>清除筛选</button>}</div><span className="subtle">缓存与推理明细不重复计入总量</span></div>}
      {!dataReady ? <div className="view-loading" role="status" aria-busy={!refreshError}>{refreshError ? "此视图尚未读取成功，请重试。" : "正在读取项目数据…"}</div> : <>
      {(tab === "tasks" || tab === "usage") && <>

        {tab === "usage" && <section className="usage-explainer"><h2>用量统计说明</h2><p>完整：执行记录和用量数据齐全。部分：已记录部分用量。未知：数据不足，无法计算总量。未调用：该任务没有发起受管 Codex 推理，记为零。</p>
          <dl><div><dt>输入</dt><dd>{n(stats?.codexUsage?.inputTokens)}</dd></div><div><dt>其中缓存读取</dt><dd>{n(stats?.codexUsage?.cachedInputTokens)}</dd></div><div><dt>输出</dt><dd>{n(stats?.codexUsage?.outputTokens)}</dd></div><div><dt>用量不完整的执行</dt><dd>{n(stats?.missingExecutions)}</dd></div></dl></section>}
        <section className="table-panel"><div className="panel-title"><h2>{tab === "usage" ? "逐任务用量" : "项目任务"}</h2><span>{runs.length} 项{offset !== null ? "已加载" : ""}</span></div>
          {!runs.length ? <div className="empty"><h3>{source || status || range !== "all" ? "没有符合条件的任务" : "还没有任务回执"}</h3><p>{source || status || range !== "all" ? "清除筛选后可查看全部任务。" : "在已连接的 MCP 客户端中开始任务，并使用 work_task 保存回执。"}</p>{source || status || range !== "all" ? <button onClick={() => { setSource(""); setStatus(""); setRange("all"); }}>查看全部任务</button> : <button onClick={showGuide}>查看接入教程</button>}</div> : <div className="table-scroll"><table className="tasks-table"><thead><tr><th>任务 / 来源</th><th>执行与验收</th><th>Codex Token</th><th>会话</th><th>开始时间</th></tr></thead><tbody>{runs.map((run) => <tr key={run.workRunId}>
            <td><button className="task-title" onClick={() => void openDetail(run.workRunId)}>{run.title}</button><div className="source-line">{sourceLabels[run.origin.entryPoint] ?? run.origin.entryPoint}{run.origin.modelLabel && <span> · {run.origin.modelLabel}（标签）</span>}</div></td>
            <td><div className="state-stack"><Badge value={run.executionStatus} /><Badge value={run.acceptanceStatus} /></div></td><td><TokenValue usage={run} compact /></td><td>{run.codexThreads}</td><td className="date">{date(run.createdAt)}</td></tr>)}</tbody></table></div>}
          {offset !== null && <button className="load-more" disabled={busy} onClick={() => void act(async () => { loadedPages.current++; await refresh(); })}>加载更多</button>}
        </section></>}
      {tab === "sessions" && <>
        <div className="registration-toolbar"><h2>项目会话</h2>{localRegistration && <button className="primary" onClick={() => setSessionDialog(true)} disabled={busy}><ConsoleIcon icon={Download} />登记已有会话</button>}</div>
        <ImportedSessions entries={imports} busy={busy} canManage={localRegistration} remove={(id) => void act(async () => {
          await api(`projects/${encodeURIComponent(projectId)}/session-imports/${encodeURIComponent(id)}/remove`, {}); setMessage("已移除登记，原会话保持不变。"); await refresh();
        })} />
        <div className="session-note"><ConsoleIcon icon={ShieldCheck} /><div><strong>受管会话归档</strong><p>归档会隐藏原聊天，保留任务和用量记录，不会停止后台进程。有外部续写、尚未验收或归属不明的会话会被跳过。</p></div></div>
        <div className="toolbar session-toolbar"><label className="check-label"><input type="checkbox" checked={acceptPartial} onChange={(event) => setAcceptPartial(event.target.checked)} />允许保留不完整的用量回执</label><div className="button-row"><button onClick={() => void preview("restore")} disabled={busy}><ConsoleIcon icon={ArchiveRestore} />恢复已归档会话</button><button onClick={() => void preview("archive")} disabled={busy}><ConsoleIcon icon={Archive} />{selection.size ? `预览归档 ${selection.size} 个会话` : "预览项目归档"}</button></div></div>
        <section className="table-panel"><div className="panel-title"><h2>受管 Codex 会话</h2><span>{threads.length} 个</span></div>{!threads.length ? <div className="empty"><ConsoleIcon icon={MessagesSquare} /><h3>没有受管 Codex 会话</h3></div> : <div className="table-scroll"><table><thead><tr><th><span className="sr-only">选择</span></th><th>会话 / 归属</th><th>来源可信度</th><th>归档状态</th><th>保留</th></tr></thead><tbody>{threads.map((thread) => <tr key={thread.id}>
          <td><input type="checkbox" aria-label={`选择 ${thread.title}`} checked={selection.has(thread.id)} onChange={(event) => setSelection((current) => { const next = new Set(current); event.target.checked ? next.add(thread.id) : next.delete(thread.id); return next; })} /></td>
          <td><strong className="thread-title">{thread.title}</strong><div className="source-line">{sourceLabels[thread.origin.entryPoint] ?? "来源待确认"} · {thread.runs.length} 次任务执行</div><code>{thread.agentId}</code></td>
          <td>{thread.externalActivity ? <Badge value="reconciliation_required">外部续写</Badge> : <Badge value={thread.createdHere && thread.identityVerified ? "passed" : "pending"}>{thread.createdHere && thread.identityVerified ? "由 TaskQuay 创建" : "关联待核实"}</Badge>}</td>
          <td><Badge value={thread.archiveState} /></td><td><button className={thread.protected ? "protect active" : "protect"} onClick={() => void act(async () => { await api(`projects/${projectId}/threads/${thread.id}/protect`, { protected: !thread.protected }); await refresh(); })} disabled={busy}>{thread.protected ? "已保留" : "设为保留"}</button></td></tr>)}</tbody></table></div>}</section>
        <section className="history-panel"><h2>归档与恢复批次</h2>{!history.length ? <p className="subtle">还没有归档或恢复记录。预览和确认结果会分别保存。</p> : history.map((entry) => <button className="history-row" key={entry.id} onClick={() => void act(async () => { setExternalIdle(false); setBatch(await api(`projects/${projectId}/archive/${entry.id}`)); })}><span>{entry.mode === "archive" ? "归档" : "恢复"} · {date(entry.created_at)}</span><Badge value={entry.status} /><span>查看回执 →</span></button>)}</section>
      </>}
      {tab === "attention" && <section className="table-panel"><div className="panel-title"><h2>运行占用与排队</h2><span>此页面不会终止进程</span></div><div className="attention-content"><p>进程仍在运行或模型会话已空闲，都不能说明任务是否完成。中断后遗留的资源占用需要单独核对，归档聊天不会释放这些占用。</p>
        {!attention.claims.length && !attention.waiters.length ? <div className="empty"><h3>当前没有资源占用或排队记录</h3><p>这里只显示 TaskQuay 的记录，其他 Codex 客户端是否仍在运行需要另行检查。</p></div> : [...attention.claims, ...attention.waiters].map((entry) => <div className="claim" key={entry.id}><strong>{entry.kind ?? "queued"}</strong><code>{entry.agent_id ?? entry.id}</code><span>{entry.access_mode} · {entry.owner_pid ? `PID ${entry.owner_pid}` : "尚未调用模型"}</span></div>)}</div></section>}
      </>}</div></>}
      <footer className="page-footer"><span>TaskQuay</span><span>项目与会话管理</span></footer>
    </main>
    {folderDialog && <FolderRegistration api={api} initialPath={project?.root ?? ""} close={() => setFolderDialog(false)} registered={(id) => {
      setFolderDialog(false); chooseProject(id); setTab("sessions"); setMessage("项目文件夹已登记。"); void refresh();
    }} />}
    {sessionDialog && project && <SessionRegistration api={api} projectId={projectId} projectRoot={project.root} close={() => setSessionDialog(false)} registered={() => {
      setSessionDialog(false); setMessage("所选会话已登记，未改动原会话和历史用量。"); void refresh();
    }} />}
    {detail && <Modal title="任务详情与完成回执" close={() => setDetail(null)}><p className="eyebrow">{sourceLabels[detail.origin.entryPoint]}</p><h3 className="detail-title">{detail.title}</h3><div className="button-row"><Badge value={detail.executionStatus} /><Badge value={detail.acceptanceStatus} /></div>
      <div className="detail-usage"><TokenValue usage={detail} /><p>回执版本 {detail.receiptRevision} · {detail.missingExecutions} 次执行的用量不完整</p></div><p>{detail.summary || "尚未提交验收摘要。"}</p>
      <h3>验收证据</h3>{detail.evidence.length ? detail.evidence.map((entry, index) => <div className="evidence" key={index}><Badge value={entry.outcome} /><strong>{entry.label}</strong><code>{entry.reference}</code></div>) : <p className="subtle">尚无验收证据。模型回复本身不能作为验收通过的依据。</p>}
      <h3>Codex 执行</h3>{detail.turns.length ? detail.turns.map((turn) => <div className="execution" key={turn.executionId}><div><code>{turn.agentId}</code><Badge value={turn.status} /></div><span>{turn.requestedModel ?? "模型未记录"} · {turn.requestedEffort ?? "推理档位未记录"}</span><strong>{n(turn.codexUsage?.totalTokens)} Token · {qualities[turn.usageStatus]}</strong><small>{turn.boundary}</small></div>) : <p className="subtle">没有 Codex 执行记录。MCP 客户端也可以直接使用本地工具完成任务。</p>}
      <h3>工具与验证操作</h3>{detail.operations.map((entry) => <div className="operation" key={entry.id}><span>{entry.label}</span><Badge value={entry.status} /></div>)}<p className="privacy-note">此处只显示任务摘要和证据引用，不展示私人聊天全文或隐藏推理。模型名称仅作为标签显示，不能据此确认实际模型。</p>
    </Modal>}
    {batch && <Modal title={batch.mode === "archive" ? "确认项目会话归档" : "确认恢复 Codex 会话"} close={() => setBatch(null)} locked={busy}>
      <p className="lead">{batch.readyCount} 个可执行 · {batch.succeededCount} 个已成功</p><p className="subtle">本次操作只处理预览清单中的会话，之后新建的会话不会加入。聊天、任务和用量历史都不会被删除。</p>
      <div className="batch-entries">{batch.entries.length ? batch.entries.map((entry) => <div className="batch-entry" key={entry.managedThreadId}><strong>{entry.title}</strong><Badge value={entry.status} />{entry.reason && <p>{reasons[entry.reason] ?? entry.reason}</p>}</div>) : <div className="empty">没有可选会话</div>}</div>
      <label className="check-label external-confirm"><input type="checkbox" checked={externalIdle} onChange={(event) => setExternalIdle(event.target.checked)} disabled={busy} />我已暂停此项目其他 Codex 客户端中的操作，确认只处理上述清单。</label>
      <p className="privacy-note">TaskQuay 无法阻止其他客户端继续操作。状态不明、有外部续写或派生关系无法确认的会话会被跳过；归档不会停止后台任务。</p>
      <button className="primary full-width" disabled={busy || !externalIdle || (!batch.readyCount && batch.status !== "reconciliation_required")} onClick={() => void execute()}>{busy ? "正在逐项核对与执行…" : batch.status === "reconciliation_required" ? "核对上次执行结果" : `确认${batch.mode === "archive" ? "归档" : "恢复"}`}</button>
    </Modal>}
  </div>;
}

const root = document.getElementById("root"); if (root) createRoot(root).render(<ConsoleApp />);
