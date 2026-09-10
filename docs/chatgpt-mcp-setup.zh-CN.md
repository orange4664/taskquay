# 将 TaskQuay 接入 ChatGPT：服务器 URL 与官方 Tunnel

[中文首页](../README.md) · [English overview](../README.en.md) · [配置参考](configuration.md)

核对日期：**2026-09-06**。本文说明如何将自己的 TaskQuay 实例接入 ChatGPT。owner 口令用于任务台登录和 TaskQuay 授权页，请自行保管。本文已核对配置、服务路由及官方资料；完整 OAuth 接入仍需在你的账号和网络环境中验证。

## 接入方式说明

| 名称 | 这里具体指什么 |
| --- | --- |
| ChatGPT 插件／应用／连接器 | 在开发者模式中加入一个 MCP server；不同账号可能显示不同名称。 |
| GPT Actions | 自定义 GPT 导入 OpenAPI schema 的另一套接口。TaskQuay 当前没有对应的 `/openapi.json`，不能把 `/mcp` 当成 OpenAPI 导入。 |
| OpenAI Secure MCP Tunnel | `tunnel-client` 主动连接 OpenAI，转发私有 MCP 请求。它与 Codex Remote、公开 HTTPS 反向代理是不同服务。 |

ChatGPT 的权限和界面可能变化。若页面与本文不同，请查阅[官方连接指南][connect]。

## 从任务台开始

登录 `/console/` 后，点击侧栏的 **接入与使用**，或直接打开 `/console/#guide`。尚未登记项目也可以阅读指南；选择项目后可复制对应的只读试用指令。

面板显示当前配置中的 MCP 地址。站点根地址为有效的公网 HTTPS URL 时可以复制；本机、内网或 HTTP 地址会提示先配置入口，含凭据、多余路径等无效地址不会显示。**HTTPS 已配置**表示地址格式符合要求，连接状态和工具是否可用仍需到 ChatGPT 检查。任务台提供操作指引，接入配置由你按下文完成。

无法自动复制时，文本会被选中，可手动复制。页面和试用指令都不包含 owner 口令。

## 接入前准备

先按 [README 的源码安装](../README.md#从源码安装)完成安装。TaskQuay 需要能访问目标项目和相关工具。若项目在家里的电脑上，服务也应运行在那台电脑上，网络入口转发到该服务；只在 VPS 上安装 TaskQuay 无法读取家里电脑的磁盘。

确认 Node、Git、pnpm 和所需 shell 可用。需要委派任务时，再安装并登录 Codex。只授权要使用的项目目录。构建会替换 `dist`，请在独立源码目录进行；配置变更后，等待活动任务结束再重启服务。

在仓库根目录运行：

```sh
node bin/devspace.js doctor
node bin/devspace.js serve
```

另开终端检查服务是否运行：

```sh
curl --fail --show-error http://127.0.0.1:7676/healthz
```

Windows PowerShell 可用：

```powershell
Invoke-RestMethod http://127.0.0.1:7676/healthz
```

`/healthz` 用于检查 HTTP 服务。OAuth、工具发现和任务执行需要分别验证。未授权时访问 `/mcp` 返回 401 是正常的，完成授权后再测试。

## 在 ChatGPT 打开创建入口

先在桌面网页配置。按当前[开发者文档][developer]，从 **Settings → Security and login → Developer mode** 开启，再到 [ChatGPT Plugins](https://chatgpt.com/plugins)，点击 **+**。有些账号的入口仍为 **Settings → Apps → Advanced settings**；组织账号可能要先由管理员授权，然后在 Workspace settings 中创建。

开发者文档与[帮助中心][help]对部分套餐的开放范围描述不一致。创建连接、调用写工具和选择 Tunnel 的权限，请以账号页面及管理员策略为准，并实际测试所需功能。找不到入口时，先向管理员或官方支持核对权限。

名称建议填 `TaskQuay`，描述可写“读取项目文件、修改代码、运行检查并返回任务回执”。接下来选择一种接入方式。

<a id="server-url"></a>
## 方式 A：服务器 URL / 公网 HTTPS 入口

这是沿用 TaskQuay 内置 OAuth 的直接接法，适合已有域名、反向代理或用户自管 HTTPS 隧道的环境。

### A1. 建立完整的 HTTP 转发路径

```text
ChatGPT → https://taskquay.example.com/mcp
                       ↓ 受控 HTTPS 反向代理或隧道
              http://127.0.0.1:7676/mcp
                       ↓
                本机 TaskQuay 与项目
```

将占位域名 `taskquay.example.com` 替换为自己的域名。代理需使用受信任的 HTTPS 证书，并将请求转发到运行 TaskQuay 的机器。注意：代理服务器上的 localhost 指向代理服务器本身。

除 `/mcp` 外，TaskQuay 还需要 OAuth 路由。建议转发整个站点根路径；如果要逐项配置，请检查以下路径：

| 路径 | 用途 |
| --- | --- |
| `/mcp` | MCP 初始化、列工具和调用。保留路径，不要被代理改写成 `/`。 |
| `/.well-known/*` | OAuth 服务和受保护资源元数据，以服务实际响应为准。 |
| `/register`、`/authorize`、`/token`、`/revoke` | 动态客户端注册、owner 授权、令牌交换／刷新及撤销。 |
| `/mcp-app-assets/*` | 启用工作区／变更卡片时所需的界面资源。 |

代理须保留 Authorization 头和流式响应；含授权信息或工具结果的响应应禁用缓存，原始请求头也不应写入公开日志。`/console/` 使用独立登录，建议保持默认 local-only 设置。请按代理产品的文档配置路由，保留 Host 校验和鉴权。

### A2. 配置 TaskQuay 的站点根地址

`publicBaseUrl` 是 OAuth 元数据等使用的**站点根地址，不带 `/mcp`**。在源码目录执行，将域名替换为自己的：

```sh
node bin/devspace.js config set publicBaseUrl https://taskquay.example.com
node bin/devspace.js serve
```

已有服务需在活动任务结束后重启，使新配置生效。临时 HTTPS 隧道换地址时，还需同步更新此配置和 ChatGPT 连接，必要时重新授权。长期使用建议采用稳定地址。

### A3. 创建 MCP 应用并完成 OAuth

| 表单字段 | TaskQuay 的填写方式 |
| --- | --- |
| Name / 名称 | `TaskQuay`。 |
| Connection / 连接 | Server URL / 服务器 URL。 |
| MCP Server URL | `https://taskquay.example.com/mcp`，这里需要 `/mcp`。 |
| Authentication / 身份验证 | 选择 OAuth。 |
| 客户端注册 | 选择动态注册（DCR）或自动注册，这是 TaskQuay 内置支持的方式。 |
| 固定 Client ID / Client Secret | 自动注册时留空。owner 口令只填在 TaskQuay 授权页。 |

创建后会进入 TaskQuay 的 owner 授权页面。核对发起客户端、scope 和资源地址，在自己的页面中输入初始化生成的口令，再返回 ChatGPT。口令保存在本机私有配置中；不要让模型读取该文件，也不要把口令粘贴到对话或 URL。

显示“已连接”后，检查工具列表。只读测试需要 `open_workspace`、`read`、`workspace_context`；要记录任务回执还需要 `work_task`。平台可能按工具权限提示确认。后续委派、修改和执行还分别需要 `agent_task`、`apply_patch`、`exec_command` 等工具，请按需要逐项验证。

<a id="official-tunnel"></a>
## 方式 B：OpenAI 官方 Secure MCP Tunnel

### B1. 确认隧道权限和登录凭据

到 [Platform Tunnels](https://platform.openai.com/settings/organization/tunnels) 创建或选择隧道。由管理员分别授予创建／编辑所需的 **Tunnels Read + Manage**，以及运行／选择所需的 **Read + Use**。隧道必须关联实际使用的 Platform organization 与 ChatGPT workspace；ChatGPT 开发者模式权限不替代 Platform 隧道权限。[官方权限与关联说明][secure-tunnel]

| 值 | 用在哪 | 不应当用在哪 |
| --- | --- | --- |
| `tunnel_id` | ChatGPT Tunnel 选择、本机 tunnel-client 配置。 | 不是密码，也不是本机工作区 ID。 |
| Tunnel runtime API key | 本机客户端连接 OpenAI 隧道控制面。 | 不是 Codex 登录、TaskQuay owner 口令或 MCP access token。 |
| TaskQuay owner 口令 | 自己的 TaskQuay OAuth 授权页和任务台登录。 | 不填入隧道 API key、Client Secret 或 HTTP Bearer 字段。 |
| TaskQuay OAuth access token | OAuth 流程生成，由 MCP 客户端使用。 | 不手工用 owner 口令或 OpenAI key 冒充。 |

日常运行使用具有相应权限的 runtime key，管理员 key 只用于管理操作。隧道权限不包含模型调用额度。[官方入门文档][tunnel-onboarding]

### B2. 下载客户端并配置 HTTP 与 OAuth/DCR

从 [OpenAI 官方 Releases](https://github.com/openai/tunnel-client/releases/latest) 或 Platform 页面下载客户端，核对操作系统、架构和发布校验信息。不同版本的命令可能变化，运行前先查看本机帮助：

```sh
tunnel-client help quickstart
```

TaskQuay 通过 HTTP `/mcp` 提供服务，`node bin/devspace.js serve` 不支持 stdio MCP。请建立 HTTP 绑定，并选择官方 OAuth/DCR 样例 `sample_mcp_with_dcr`。

**Windows PowerShell 示例**：在单独终端运行，按提示输入实际隧道 ID。API key 使用隐藏输入，避免写入命令历史。

```powershell
$env:CONTROL_PLANE_TUNNEL_ID = Read-Host "Tunnel ID"
$runtimeSecret = Read-Host "Tunnel runtime API key" -AsSecureString
$env:CONTROL_PLANE_API_KEY = ([System.Net.NetworkCredential]::new("", $runtimeSecret)).Password
Remove-Variable runtimeSecret

# 仅限本机 loopback HTTP。对跨主机或公网 MCP 必须使用 HTTPS。
$env:HARPOON_ALLOW_PLAINTEXT_HTTP = "true"

tunnel-client init --sample sample_mcp_with_dcr --profile taskquay --tunnel-id $env:CONTROL_PLANE_TUNNEL_ID --mcp-server-url http://127.0.0.1:7676/mcp
tunnel-client doctor --profile taskquay --explain
tunnel-client run --profile taskquay

# run 结束后移除当前终端中的运行密钥。
Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
```

**Bash 示例**：以下命令须在 Bash 中运行，明文 HTTP 仅用于本机回环地址。

```bash
read -r -p "Tunnel ID: " CONTROL_PLANE_TUNNEL_ID
read -r -s -p "Tunnel runtime API key: " CONTROL_PLANE_API_KEY
printf '\n'
export CONTROL_PLANE_TUNNEL_ID CONTROL_PLANE_API_KEY
export HARPOON_ALLOW_PLAINTEXT_HTTP=true

tunnel-client init --sample sample_mcp_with_dcr --profile taskquay --tunnel-id "$CONTROL_PLANE_TUNNEL_ID" --mcp-server-url http://127.0.0.1:7676/mcp
tunnel-client doctor --profile taskquay --explain
tunnel-client run --profile taskquay

unset CONTROL_PLANE_API_KEY
```

`HARPOON_ALLOW_PLAINTEXT_HTTP` 是官方客户端对本地 HTTP OAuth discovery 的显式选项，不是关闭 TaskQuay 鉴权、忽略 TLS 校验或允许公网明文密码。能提供本机可信 HTTPS 时优先使用 HTTPS 并不设置该变量。[官方 connector 说明][tunnel-connectors]

**doctor 失败时，先排查原因，再执行 run。** 配置中包含隧道标识，环境中包含运行凭据，请勿将它们提交到 Git 或公开的 Issue、截图中。

### B3. 配置 OAuth 授权页面的访问路径

**官方隧道转发 MCP，并不自动把任意 OAuth 服务器路径都变成公网地址。** 官方支持发现与部分登记的 token／注册／撤销 shim 路径，但浏览器 `authorization_endpoint` 不会自动改写；未被 shim 处理的公开端点由实际 OAuth 调用方访问。[官方路由说明][tunnel-connectors]

TaskQuay 将 OAuth 与 MCP 放在同一服务中。两种网络配置的要求如下：

| 网络配置 | 需要完成的设置 |
| --- | --- |
| 隧道转发本机 `/mcp`，OAuth 仍使用自己控制的 HTTPS 根地址 | 需要让浏览器及相应调用方能访问授权页和必要端点，再实测完整流程。MCP 本身可以不公开。 |
| 所有端点都只在 localhost | 浏览器和云端调用方无法直接访问本机授权端点。需为 OAuth 配置可达路径；无法配置时，使用方式 A。 |

混合部署时保留真实、可达的 TaskQuay `server.publicBaseUrl`，不要把它直接改成 OpenAI API 根域或整个 tunnel MCP URL。核对 authorization server 元数据与浏览器页面实际指向哪里；启用可选卡片时，`/mcp-app-assets/*` 也需有对应的资源访问路径。全私网 OAuth 代理方案仍需单独验证。

隧道对外 MCP resource 可能与 TaskQuay 原资源标识不同。当前源码有 `oauth.resourceAliases` 精确别名支持。**只有在授权请求中核对实际资源值后**，将自己这个隧道的准确 URL 合并进现有私有配置；不要添加通配、他人隧道或猜测的域名。下面的合并片段使用占位值：

```json
{
  "configVersion": 1,
  "server": {
    "host": "127.0.0.1",
    "port": 7676,
    "publicBaseUrl": "https://taskquay.example.com"
  },
  "oauth": {
    "resourceAliases": [
      "https://api.openai.com/v1/mcp/tunnel_REPLACE_WITH_ACTUAL_ID"
    ]
  }
}
```

这是**合并片段**，不要覆盖已有授权目录、provider、日志或 console 配置。资源别名用于匹配资源身份。配置后仍须完成登录，并确保授权页面可达。对应实现是 `src/config-schema.ts` 与 `src/oauth-provider.ts`。

### B4. 在 ChatGPT 选择 Tunnel 并验证

保持 TaskQuay 和 `tunnel-client run` 都在线。在创建连接表单中选择 **Connection → Tunnel**，选择列表中的隧道或填入自己的完整 `tunnel_id`，继续 OAuth 授权和工具发现。runtime API key 不填入该表单。

隧道未出现在列表时，核对工作区关联、Platform organization 和使用权限。

官方客户端默认健康端口为 8080；以启动输出为准，端口冲突时按帮助配置单独的 loopback 监听：

```sh
curl --fail --show-error http://127.0.0.1:8080/healthz
curl --fail --show-error http://127.0.0.1:8080/readyz
```

`http://127.0.0.1:8080/ui` 是隧道客户端自己的诊断界面，`http://127.0.0.1:7676/console/` 才是 TaskQuay 任务台。完成这些本机检查后，再按下一节测试云端权限、OAuth 和工具调用。[官方故障诊断][tunnel-troubleshooting]

官方 Tunnel 面向私有连接和开发者测试；公开插件目录提交仍要求稳定公网 HTTPS 端点。开源仓库本身不会开放你电脑上的服务。[官方隧道指南][secure-tunnel]

## 首次验收与日常使用

在新网页对话的工具／插件菜单中选择 TaskQuay，或明确提及该应用。先选一个已授权的测试项目，依次检查：

| 步骤 | 验收依据 |
| --- | --- |
| 打开工作区、读取说明 | 确认工具已执行，返回的路径和文件内容正确。 |
| 建立并结束纯主控工作 | `work_task` 回执与任务台记录一致，未启动 Codex 的工作显示“未调用”。 |
| 明确授权一个小范围修改 | diff 正确，项目原测试不被无故改变，操作仍受权限和资源约束。 |
| 明确授权 Codex 委派 | 检查受管任务、关联会话和来源；实际推理应记录用量，事件不全时显示未知。 |
| 验收后再尝试长任务 | 持续运行、重试与恢复有证据；不要用已发布生产系统做首次连通测试。 |

对话提示示例：

> 使用 TaskQuay 打开 `<已授权的项目绝对路径>`，建立本次工作记录。先由主控直接读取有关文件，不做全仓重复调查。需要实现时再委派 Codex，相关后续优先复用会话。完成适当测试后返回变更、验收范围和 Codex 用量回执。不要自行部署、公开推送、归档聊天或执行破坏性操作。

ChatGPT 可用的记忆和历史取决于当前产品模式，这些内容不会自动完整传给 Codex。请把必要约束写入任务或 AGENTS.md。写入操作仍受平台的确认设置约束，见[官方说明][developer]。

官方自定义 MCP FAQ 当前标注 web-only，原生手机 App 不在支持范围内。先在桌面网页完成验证，再检查手机浏览器能否选择并调用连接。手机使用也需要可用的 MCP 客户端和网络。[帮助中心][help]

## 持续运行、更新与排错

主机、TaskQuay 和隧道或代理都应保持在线。首次接入建议在前台运行，方便查看错误。验证成功后，可按操作系统和客户端文档配置后台服务，并保留状态查询、停止和重启的方式。同一实例只运行一份服务；任务是否完成，请查看任务回执。

| 现象 | 优先检查 |
| --- | --- |
| 没有 Developer mode／创建／Tunnel 入口 | 账号和工作区权限、界面版本；不是本机文件路径问题。 |
| 创建时工具发现失败 | TaskQuay 进程、HTTPS 路由、隧道轮询、OAuth discovery；不要只检查 `/healthz`。 |
| OAuth 页面打不开 | `publicBaseUrl`、授权端点的调用方可达性；Tunnel 不自动代理浏览器授权页。 |
| 401／Invalid resource | 是否完成真实 OAuth、实际 resource 与精确别名是否匹配、access token 是否到期；owner 口令不是 Bearer token。 |
| 隧道 doctor 通过但远端 403 | runtime key 的 Read + Use、实际 tunnel ID 及 org/workspace 关联。 |
| URL 出现重复 `/mcp` 或 404 | 站点根地址与 MCP endpoint 分开填写，代理不剥掉原路径。 |
| 更新代码后工具不存在或 schema 报错 | 先确认服务运行的是新构建，再在连接详情 Refresh；组织发布版按管理员审核流程更新。 |
| 任务中断后不知道是否已写入／发布 | 先查工作记录、进程占用和远端回执，确认上次操作结果后再决定是否重试。 |
| 手机能聊天但不能选 MCP | 检查实际客户端支持和消息级应用选择；聊天可用不等于该客户端具备开发者 MCP。 |

工具名称、描述、schema 或认证变化后，在 ChatGPT 连接详情执行 Refresh 并重新测试。必要时在新对话重新选择应用；公开已发布的连接可能需要管理员发布新的元数据快照。[官方刷新流程][connect]

## 参考来源

本教程参考了[yyjeqhc 的 webcodex 介绍](https://linux.do/t/topic/2544729)中按部署、授权和使用分步说明的方式，命令与接口则依据 TaskQuay 和官方资料编写。webcodex 的体验服务器、安装包和 GPT Actions 配置不适用于此处。

TaskQuay 直接读取文件时不启动 Codex 推理；实际委派 Codex 会产生用量，账号和服务分别适用各自条款。

## 资料与验证范围

本文核对了 TaskQuay 的配置 schema、OAuth provider、初始化及服务路由，并参考以下官方资料。验证范围限于源码、文档和配置片段，未完成真实隧道与 OAuth 全流程测试，也未验证不同账号和手机环境。

- [OpenAI：ChatGPT Developer mode][developer]
- [OpenAI：连接与测试 MCP 插件][connect]
- [OpenAI Help Center：Developer mode 与移动端 FAQ][help]
- [OpenAI：Secure MCP Tunnel][secure-tunnel]
- [OpenAI tunnel-client：Onboarding][tunnel-onboarding]
- [OpenAI tunnel-client：Connector 与 OAuth 行为][tunnel-connectors]
- [OpenAI tunnel-client：Troubleshooting][tunnel-troubleshooting]

[developer]: https://developers.openai.com/api/docs/guides/developer-mode
[connect]: https://developers.openai.com/plugins/deploy/connect-chatgpt
[help]: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
[secure-tunnel]: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
[tunnel-onboarding]: https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md
[tunnel-connectors]: https://github.com/openai/tunnel-client/blob/master/docs/connectors.md
[tunnel-troubleshooting]: https://github.com/openai/tunnel-client/blob/master/docs/troubleshooting.md
