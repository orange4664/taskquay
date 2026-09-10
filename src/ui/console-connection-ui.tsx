import React, { useEffect, useId, useRef, useState } from "react";
import { BookOpen, Check, Copy, ExternalLink, FolderPlus, RefreshCw } from "lucide";
import { ConsoleIcon } from "./console-modal.js";
import type { ConsoleApi } from "./console-registration-ui.js";
import type { ConsoleConnection } from "../console-connection.js";
import "./console-connection.css";

function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true); setFeedback("已复制");
    } catch {
      field.current?.focus(); field.current?.select();
      setCopied(false); setFeedback("浏览器未允许复制，已选中文本，可手动复制。");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setCopied(false); setFeedback(""); }, 4000);
  };
  return <div className="copy-field">
    <div><label htmlFor={fieldId}>{label}</label><textarea id={fieldId} ref={field} value={value} readOnly rows={multiline ? 4 : 2} spellCheck={false} /></div>
    <button onClick={() => void copy()} aria-label={`复制${label}`}><ConsoleIcon icon={copied ? Check : Copy} />{copied ? "已复制" : "复制"}</button>
    <span className="copy-feedback" role="status">{feedback}</span>
  </div>;
}

export function ConnectionGuide({ api, projectRoot, canRegister, addFolder }: {
  api: ConsoleApi; projectRoot?: string; canRegister: boolean; addFolder: () => void;
}) {
  const [connection, setConnection] = useState<ConsoleConnection | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setConnection(null); setError("");
    void api<ConsoleConnection>("connection").then((data) => { if (current) setConnection(data); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "无法读取接入配置。"); });
    return () => { current = false; };
  }, [api, attempt]);
  const prompt = `请通过 TaskQuay 打开项目 ${JSON.stringify(projectRoot)}，先列出顶层文件并读取 README（如果存在），用中文概述项目结构。仅做只读检查，不修改文件、不执行命令、不启动 Codex 任务；操作超出这个目录前先征求我的同意。`;
  return <section className="connection-guide view-content" aria-label="ChatGPT 接入指南">
    <div className="guide-intro"><p className="lead">从选择项目，到第一条任务。</p><p>TaskQuay 在这台电脑上管理项目。完成一次授权后，你可以在 ChatGPT 中调用本机工具，这里会保留任务和用量回执。</p></div>
    <div className="connection-status" aria-label="接入状态">
      <div><span className="status-marker ready" /><span>本机管理台<strong>已登录</strong></span></div>
      <div><span className="status-marker" /><span>服务器地址<strong>{connection ? connection.urlStatus === "https" ? "HTTPS 已配置" : connection.urlStatus === "local" ? "需要公网 HTTPS 入口" : "需要检查配置" : error ? "读取失败" : "读取中…"}</strong></span></div>
      <div><span className="status-marker" /><span>ChatGPT 授权<strong>请在 ChatGPT 中确认</strong></span></div>
    </div>
    <p className="guide-status-note">地址已配置不代表连接成功；是否可达、已授权及发现工具，以 ChatGPT 的实际结果为准。</p>
    {error && <div className="notice error" role="alert"><span>{error}</span><button onClick={() => setAttempt((value) => value + 1)}><ConsoleIcon icon={RefreshCw} />重试读取配置</button></div>}
    <ol className="guide-steps">
      <li><div className="step-number" aria-hidden="true">1</div><div className="step-content"><h2>选择可以访问的项目</h2>
        <p>先添加项目文件夹，再从侧栏选择它。已有 Codex 会话可在“Codex 会话 → 登记已有会话”中逐项选择。</p>
        {projectRoot ? <div className="guide-project"><span>当前项目</span><code>{projectRoot}</code></div> : <p className="guide-hint">还没有选择项目。添加后，这里会生成对应的试用指令。</p>}
        {canRegister && <button onClick={addFolder}><ConsoleIcon icon={FolderPlus} />添加项目文件夹</button>}
        <p className="subtle">登记会话保存标题等索引信息，不导入聊天正文，也不自动开始任务。</p>
      </div></li>
      <li><div className="step-number" aria-hidden="true">2</div><div className="step-content"><h2>在 ChatGPT 添加 TaskQuay</h2>
        <p>桌面网页打开“设置 → 安全与登录 → 开发者模式”，再到插件页点击“+”。部分账号入口在“应用 → 高级设置”；组织账号可能需要管理员开通。</p>
        <a className="guide-link" href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">打开 ChatGPT 插件页<ConsoleIcon icon={ExternalLink} /></a>
        <dl className="connection-fields"><div><dt>名称</dt><dd>TaskQuay</dd></div><div><dt>连接方式</dt><dd>Server URL / 服务器 URL</dd></div><div><dt>身份验证</dt><dd>OAuth · 动态注册（自动）</dd></div></dl>
        {connection?.urlStatus === "https" && connection.mcpUrl ? <CopyField label="MCP 服务器地址" value={connection.mcpUrl} /> : connection && <div className="guide-hint"><strong>{connection.urlStatus === "local" ? "先准备可访问的 HTTPS 入口" : "站点地址配置有误"}</strong><p>按完整教程将站点根路径转发到本机服务，并配置 publicBaseUrl。ChatGPT 无法直接访问这台电脑的 localhost 地址。</p></div>}
        <p>Client ID 和 Client Secret 使用自动注册，不手填。跳转到你自己的 TaskQuay 授权页后，输入与本机管理台相同的口令，再返回 ChatGPT。</p>
        <p className="subtle">口令只填在自己的授权页，不粘贴到聊天、URL 或客户端密钥栏。TaskQuay 使用 MCP，不能导入为 GPT Actions 的 OpenAPI。</p>
      </div></li>
      <li><div className="step-number" aria-hidden="true">3</div><div className="step-content"><h2>用一条只读任务验证</h2>
        <p>在新对话中选择 TaskQuay，确认能看到工具列表，再发送下面的指令。项目概述成功返回后，才算完成这一步。</p>
        {projectRoot ? <CopyField key={projectRoot} label="首条试用指令" value={prompt} multiline /> : <p className="guide-hint">先选择项目，即可复制专属的只读试用指令。</p>}
        <p className="subtle">需要任务回执时，让 ChatGPT 使用 work_task 记录工作；只有调用 Codex 产生的已知用量才会计入本页。</p>
      </div></li>
    </ol>
    <section className="guide-faq"><h2>常见问题</h2>
      <details><summary>为什么看不到已有的 Codex 会话？</summary><p>管理台只列出受管会话和你手动登记的引用。先选对项目文件夹，再点击“登记已有会话”；搜索词和归档状态也会影响结果。登记不会把历史用量写成零。</p></details>
      <details><summary>地址填好了，仍然连不上？</summary><p>检查电脑是否唤醒、服务与隧道是否运行，publicBaseUrl 是否与当前 HTTPS 地址一致。代理需要转发站点根路径及 OAuth 路由。未授权访问 /mcp 返回 401 属于正常鉴权；只检查 /healthz 不能证明连接成功。</p></details>
      <details><summary>ChatGPT 能访问哪些内容？</summary><p>文件工具按授权目录检查访问范围。命令工具使用本机用户权限，授权目录不构成系统级沙箱；只向你信任的客户端授权。首次验证使用上方的只读指令。</p><p>{connection?.consoleLocalOnly ? "当前管理台仅允许本机访问。" : connection ? "当前配置允许 HTTPS 远程管理台访问。" : "管理台访问范围尚未读取。"} 会话登记仍需在运行服务的电脑上操作。</p></details>
    </section>
    <a className="guide-link guide-docs" href="https://github.com/orange4664/taskquay/blob/main/docs/chatgpt-mcp-setup.zh-CN.md" target="_blank" rel="noopener noreferrer"><ConsoleIcon icon={BookOpen} />阅读完整教程：HTTPS 与官方 Tunnel<ConsoleIcon icon={ExternalLink} /></a>
  </section>;
}
