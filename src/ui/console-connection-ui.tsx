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
      setCopied(false); setFeedback("无法自动复制，文本已选中，请手动复制。");
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
    <div className="guide-intro"><p className="lead">在 ChatGPT 中使用本机项目</p><p>TaskQuay 连接 ChatGPT 与这台电脑上的项目。授权后，在 ChatGPT 中下达任务，在任务台查看执行记录和用量。</p></div>
    <div className="connection-status" aria-label="接入状态">
      <div><span className="status-marker ready" /><span>本机任务台<strong>已登录</strong></span></div>
      <div><span className="status-marker" /><span>服务器地址<strong>{connection ? connection.urlStatus === "https" ? "HTTPS 已配置" : connection.urlStatus === "local" ? "需要公网 HTTPS 入口" : "需要检查配置" : error ? "读取失败" : "读取中…"}</strong></span></div>
      <div><span className="status-marker" /><span>ChatGPT 授权<strong>请在 ChatGPT 中确认</strong></span></div>
    </div>
    <p className="guide-status-note">这里显示的是地址配置。请到 ChatGPT 检查连接状态、授权结果和工具列表。</p>
    {error && <div className="notice error" role="alert"><span>{error}</span><button onClick={() => setAttempt((value) => value + 1)}><ConsoleIcon icon={RefreshCw} />重试读取配置</button></div>}
    <ol className="guide-steps">
      <li><div className="step-number" aria-hidden="true">1</div><div className="step-content"><h2>选择项目文件夹</h2>
        <p>添加文件夹后，在侧栏选中项目。要显示已有的 Codex 会话，进入“Codex 会话 → 登记已有会话”勾选。</p>
        {projectRoot ? <div className="guide-project"><span>当前项目</span><code>{projectRoot}</code></div> : <p className="guide-hint">添加并选中项目后，即可复制试用指令。</p>}
        {canRegister && <button onClick={addFolder}><ConsoleIcon icon={FolderPlus} />添加项目文件夹</button>}
        <p className="subtle">登记会话只保存标题等索引信息，不导入聊天正文或启动任务。</p>
      </div></li>
      <li><div className="step-number" aria-hidden="true">2</div><div className="step-content"><h2>在 ChatGPT 中添加 TaskQuay</h2>
        <p>在 ChatGPT 桌面网页的“设置 → 安全与登录”中开启开发者模式，再到插件页点击“+”。部分账号的入口在“应用 → 高级设置”，组织账号可能需要管理员开通。</p>
        <a className="guide-link" href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">打开 ChatGPT 插件页<ConsoleIcon icon={ExternalLink} /></a>
        <dl className="connection-fields"><div><dt>名称</dt><dd>TaskQuay</dd></div><div><dt>连接方式</dt><dd>Server URL / 服务器 URL</dd></div><div><dt>身份验证</dt><dd>OAuth · 动态注册（自动）</dd></div></dl>
        {connection?.urlStatus === "https" && connection.mcpUrl ? <CopyField label="MCP 服务器地址" value={connection.mcpUrl} /> : connection && <div className="guide-hint"><strong>{connection.urlStatus === "local" ? "先配置 HTTPS 地址" : "站点地址配置有误"}</strong><p>ChatGPT 无法直接访问本机的 localhost 地址。请按完整教程配置 HTTPS 转发和 publicBaseUrl，转发范围需包含站点根路径。</p></div>}
        <p>选择自动注册，Client ID 和 Client Secret 留空。跳转到自己的 TaskQuay 授权页后，输入任务台登录口令，再返回 ChatGPT。</p>
        <p className="subtle">口令只填在自己的授权页，不要放进聊天、URL 或客户端密钥栏。TaskQuay 的 MCP 地址不能作为 OpenAPI 导入 GPT Actions。</p>
      </div></li>
      <li><div className="step-number" aria-hidden="true">3</div><div className="step-content"><h2>发送一条只读测试指令</h2>
        <p>在新对话中选择 TaskQuay，检查工具列表，再发送下面的指令。确认返回的项目概述与实际文件一致。</p>
        {projectRoot ? <CopyField key={projectRoot} label="首条试用指令" value={prompt} multiline /> : <p className="guide-hint">选择项目后，即可复制对应的只读试用指令。</p>}
        <p className="subtle">要保存任务回执，请让 ChatGPT 使用 work_task 记录工作。这里统计的是已记录的 Codex 用量。</p>
      </div></li>
    </ol>
    <section className="guide-faq"><h2>常见问题</h2>
      <details><summary>为什么看不到已有的 Codex 会话？</summary><p>任务台列出由 TaskQuay 管理的会话，以及你手动登记的会话。请核对项目文件夹，点击“登记已有会话”，再检查搜索词和归档筛选。无法统计的历史用量显示为未知。</p></details>
      <details><summary>地址填好了，仍然连不上？</summary><p>检查电脑是否唤醒、服务和隧道是否运行，以及 publicBaseUrl 是否与当前 HTTPS 地址一致。代理须转发站点根路径和 OAuth 路由。未授权时，/mcp 返回 401 是正常的；/healthz 只能检查服务是否运行。</p></details>
      <details><summary>ChatGPT 能访问哪些内容？</summary><p>文件访问受目录授权限制。命令工具以本机用户权限运行，目录授权不构成系统级沙箱，因此请只向可信客户端授权。首次连接可用上方的只读指令测试。</p><p>{connection?.consoleLocalOnly ? "当前任务台仅允许本机访问。" : connection ? "当前配置允许通过 HTTPS 远程访问任务台。" : "尚未读取任务台的访问设置。"} 会话登记仍需在运行服务的电脑上操作。</p></details>
    </section>
    <a className="guide-link guide-docs" href="https://github.com/orange4664/taskquay/blob/main/docs/chatgpt-mcp-setup.zh-CN.md" target="_blank" rel="noopener noreferrer"><ConsoleIcon icon={BookOpen} />阅读完整教程：HTTPS 与官方 Tunnel<ConsoleIcon icon={ExternalLink} /></a>
  </section>;
}
