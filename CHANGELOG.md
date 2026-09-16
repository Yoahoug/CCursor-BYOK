# 更新日志

本文件记录本二改版（相对上游 **CCursor / Cursor++**）的全部改动。
fork 基准为上游 `0.0.15`。README 只负责「这是什么 / 怎么装 / 怎么配」，
改动的原因与细节放在这里。

> `0.0.18` ~ `0.0.20` 未单独发包，内容并入 `0.0.21`。

---

## 0.0.22 — 界面打磨

### 浮层改为毛玻璃

面板的浮层（两处下拉、toast）原本用 `--cpp-surface` 作底。但那是「当前前景色的
4% 叠加」—— 衬在面板上做卡片背景刚好，当**浮层**底就等于全透明：底下的字段文字
会直接透上来和选项叠在一起，两层字互相干扰，谁都读不清。

另起一套浮层材质：取主题里本就给下拉/悬浮件用的 `editorWidget` 背景作基底，
再叠背景模糊。半透明、能透出环境色，但底下内容被虚化到不影响阅读。

语义色 toast 有个连带问题：原先直接 `background: var(--cpp-danger-soft)` 覆盖，
一覆盖又变回透明。改为两层背景叠加（色调层压在玻璃底之上），两个效果都保住。

### 修复密码框旁的图标不显示

图标来自 **Cursor 本体**的 `codicon.ttf`（在扩展目录之外，省得自己再打包一份
141KB 字体），但 webview 只允许加载 `localResourceRoots` 之内的本地资源，
而代码没有声明它 —— 字体请求被拦下后静默回退到系统字体，而 `.codicon` 用的是
私有区码位，系统字体里没有，于是渲染成缺字方块。

注意 `localResourceRoots` 一旦显式给出就会**替换**默认值，所以扩展目录必须一并列上。
顺带加了字体存在性检查：找不到就不注入 `@font-face`（按钮是空的，好过方块乱码）。

### 协议分段控件改为一行居中

`.seg-btn` 原本是 `flex-direction: column`，而三档并排时每档只有约 60px，
`Anthropic Messages` 这种全称会被折成两行、把三个按钮撑得高低不齐。
改为一行居中 + `white-space: nowrap`，标签同时换成短名（全称移入悬浮提示）。

### 仪表盘：删掉冗余指标，补上总量

`Cache Write` 卡片的值取的是 `nonCachedInputTokens`（该中转站不上报
`cache_creation_input_tokens`），而命中率卡片下方那行 `4.2M new` 用的是同一个量 ——
等于把一份数据画了两遍，其中一遍还只标了个 `est.`。

该卡片删除，改为独立的一块 **Prompt 总量**（缓存读取 + 未命中输入，即这一窗口
真正发给模型的输入量）。它原先只是 Calls 卡片下面一行几乎看不见的小字，
升为独立卡片后 Calls 下方那行就去掉了。

指标网格同时改为 6 等分，使「主指标通栏」与「小卡片三等分」两种跨度能并存，
消除原先 Calls 单独占一行的空位。

### 顺带修正

- OpenAI 一档的提示文案漏了 `/v1`。地址改为「前缀 + 协议补全」之后实际路径是
  `/v1/chat/completions`，原文案还停留在 `/chat/completions`，等于提示本身会误导人。

---

## 0.0.21 — 协议下沉、连通性测试、用量仪表盘

### 协议从「中转站级」下沉到「模型级」

**问题**：协议原本是整个中转站的属性。但一个中转站（一个地址、一个 Key）几乎总会
同时挂 `gpt` / `gemini` / `grok` / `glm` / `deepseek`，各家走各的接口形态 ——
而分流是中转站内部做的。用户既无法判断「这个中转站属于哪一类协议」，也不该为了
同一个地址建好几条 provider 记录、把密钥重复填。

**改动**：

- 协议移到 `ProviderModel.type`，中转站那层不再有协议设置
- 未显式选择时按模型名推导（官方域名推 Responses，中转站推 Chat Completions，
  其余回落到 Anthropic Messages —— 第三方聚合中转站以 Anthropic 形态最普遍），
  并在保存/测试前**固化**进配置
- 探测规则只有一条，在 `src/shared/providerProtocol.ts`。服务端不重复实现推导，
  否则两边会悄悄分叉成「界面说 Anthropic、实际请求走 OpenAI」

`provider.type` 字段保留，但降级为「模型没有 `type` 时的回落值」，只为手写的
`providers.json` 服务。

### 地址改为只填前缀，版本段由协议补全

**根因**：两个 SDK 都是 `baseURL + path` 的字符串直拼，不做任何智能补全，
而它们对版本段的要求**正好相反**：

| 协议 | baseURL 该不该带 `/v1` | 原因 |
|---|---|---|
| `anthropic` | **不该** | SDK 自己拼 `/v1/messages` |
| `openai-chat` | **必须** | SDK 只拼 `/chat/completions` |
| `openai-responses` | **必须** | SDK 只拼 `/responses` |
| `gemini` | **不该带 `/v1beta`** | SDK 自己拼 |

所以「一个中转站一个 baseURL」**不可能同时喂对 Anthropic 与 OpenAI 模型**：
带 `/v1` 则 Anthropic 变成 `/v1/v1/messages`，不带则 OpenAI 打到
`/chat/completions` 而中转站实际是 `/v1/chat/completions`，直接 404。

**改动**：用户只填地址前缀，版本段与请求路径都由生效协议决定。
同一个前缀 `http://10.66.66.66:8317` 挂不同模型会各自拼对：

```text
anthropic         → http://10.66.66.66:8317/v1/messages
openai-chat       → http://10.66.66.66:8317/v1/chat/completions
openai-responses  → http://10.66.66.66:8317/v1/responses
gemini            → http://10.66.66.66:8317/v1beta/models/<model>:streamGenerateContent
```

前缀里已经带了该版本段就不重复；反过来，不该带的协议会把它剥掉，
因此老配置里带着 `/v1` 的地址会被自动纠正，而不是变成 `/v1/v1/messages`。

代价是提示语变少了：原先两条「OpenAI 缺 `/v1`」「Anthropic 多带 `/v1`」的警告
已无意义（现在自动处理），只剩一个真坑 —— 把**完整端点**当前缀填进来（路径会拼两遍）。

### 模型连通性测试

面板里可对单个模型发一次真实请求，走的是与正式调用**完全相同的代码路径**
（含地址拼接、鉴权、参数装配、SSE 解析），因此测通基本就等于能用，而不只是
「端口开着」。

指标设计上有两个刻意的选择：

- **提示词是为测量设计的**，不是 ping。让模型「输出 1 到 120」能产生长度稳定、
  非平凡（约 600 token）的输出；纯 ping 只有一两个 token，算出来的 tokens/s
  会被首字延迟完全淹没
- **双首字指标**：thinking 模型的第一个事件是思考 token 而非正文。只记「第一个字节」
  会得到一个好看但毫无意义的首字延迟，所以「正文首字」与「首个响应事件」分开记

### 协议一键探测

中转站同时挂多家模型时，接口形态和模型名之间没有可靠对应关系 ——
`glm-4.6` 可能走 Anthropic 路径也可能走 OpenAI 路径，只有打一发真实请求才知道。

所以提供 Auto-detect：把该模型逐个协议试一遍，返回能通的那个并直接写进配置。
把「当前生效协议」放在第一个试（它通常就是对的，命中时只花一次请求）；
刻意串行以免触发限流；只在用户显式点击时才跑。

### 用量统计仪表盘

新增 `~/.ccursor/usage-stats.jsonl`：每完成一轮追加一条记录，据此算出缓存命中率、
每日趋势、按模型与中转站归因。

主打指标是**缓存命中率**（缓存读取 / (缓存读取 + 未命中输入)），而不是笼统的
token 总量 —— 它要回答的具体问题是「我的中转站有没有真的在做前缀缓存」。

各协议对「输入 token」的定义并不一致，落统计前统一归一化：

| 协议 | 口径 |
|---|---|
| `anthropic` | `input_tokens` **不含**缓存读写，缓存量在独立字段里 |
| `openai-chat` | `prompt_tokens` **已包含** `cached_tokens`（是子集） |
| `openai-responses` | `input_tokens` 已包含 `cached_tokens` |
| `gemini` | `promptTokenCount` 已包含隐式缓存命中 |

直接相加会把 anthropic 的 prompt 少算、把 OpenAI 的缓存重复计入。

统计行同时记 `provider`（显示名）与 `providerId`（稳定 id）—— 名称可以被用户改、
id 不会，改名后才把历史数据归到一起，否则同一个中转站会被拆成两行、命中率也被拆散。

### 其他

- **修复仪表盘首屏不显示**：`activeTab` 初值就是 `dashboard`，而两个拉取入口
  （`setTab` / `toggleUsage`）都不会被触发，必须手切页签才加载。改为首次收到
  state 时主动拉一次
- **危险操作加二次确认**：删除中转站 / 移除模型现在要确认，并说明影响范围
- **删除若干无人阅读的说明性提示**：常驻的推算说明挪到 `est.` 角标的悬浮提示里

---

## 0.0.17 — 发布链路改造

### 更新检测改走本仓库

原 `update-check.ts` 查的是 npm 上的 `@cometix/ccursor`，并提示执行
`npx @cometix/ccursor update` —— 这条命令装的是**官方版**，会把二改的地方整个覆盖掉。

改为检查本仓库的 GitHub Release（仓库是 public，匿名可读，不需要 token）。
提示里提供 **Update Now**：直接下载 Release 里挂着的 `.vsix`，解压后就地覆盖当前
扩展目录，完成后提示重启 Cursor。另给 **Release Notes** 与 **Later** 两个选项。

下载地址取自 Release 资产而非 npm，因此不依赖 npm 上是否存在同名包 ——
发布通道完全由本仓库掌控。

### 线上构建改为本地一键发布

原先由 GitHub Actions 打 tag 后自动构建发布。但线上构建持续报错，且排查链路很长:
build agent 上没有 Cursor 环境，扩展到原生模块相关的失败很难在远端复现。

**删除**：`release.yml`（线上构建发布）、`ci.yml`（远端构建门禁）、
`scripts/pre-commit` + `scripts/install-hooks.mjs`（本地 pre-commit 门禁）、
`Cursor++/scripts/verify.mjs`（上述两者共用的门禁脚本）。

**保留**：`upstream-watch.yml`（每日检测上游更新，只提醒、不自动合并）。

新流程只依赖一条命令：

```bash
node scripts/release.mjs --bump patch
```

依次完成：前置检查 → 版本一致性 → typecheck/lint/单测 → 生产构建 →
多端产物校验 → 打包 VSIX → 更新本地扩展 → 提交版本号 / 打 tag / 推送 / 发 Release。

#### 为什么默认同时更新本地扩展

只推 Release 的话，本机跑的还是旧代码 —— 这个仓库就踩过这个坑：二改功能都已提交，
但本地扩展停在旧构建上，而**版本号没变**，从版本上根本看不出差异。
所以默认把本地一并更新，保证「发出去的版本 = 本机在跑的版本」。

几个实现上的取舍：

- **顺序放在推送之前**。这样「装不上」这类问题会在创建公开 Release 之前就暴露；
  反过来会出现「Release 已发布、本机却没更新成功」的半成品状态
- **不调用 installer 的 `install()`**。那条路径会连带重打 Cursor 本体补丁
  （renderer hook / always-local / 签名绕过…），而这里只是替换扩展本体，
  补丁早就在位，重打一遍既慢又多一份备份噪音
- **按内容差异写入**，而不是整体删除重拷。目录里体积最大的是一整套 supermarkdown
  原生模块（8 个 `.node`，约 27MB）而它们几乎从不变化，无条件重写会让「某个 `.node`
  正被运行中的 Cursor 占用」直接导致整个安装失败
- **装完校验**：确认多端原生模块都在、且落盘的 `package.json` 版本与目标版本一致
- **旧版本备份**到 `~/.ccursor/backups/`（保留最近 3 份）。特意不放在 `/tmp` ——
  那里重启后会被系统清掉，真要回滚时已经没了

#### 为什么本地构建依然兼容多端

VSIX 里带的不是单平台产物。`supermarkdown` 的原生模块按平台分发，构建时会被
**全部**复制进 `dist/` 并打进包：

```text
supermarkdown.darwin-arm64.node      supermarkdown.linux-x64-gnu.node
supermarkdown.darwin-x64.node        supermarkdown.linux-x64-musl.node
supermarkdown.linux-arm64-gnu.node   supermarkdown.win32-arm64-msvc.node
supermarkdown.linux-arm64-musl.node  supermarkdown.win32-x64-msvc.node
```

扩展在运行时按 `process.platform` / `arch` 加载对应文件，因此**在 macOS 上构建出的
VSIX 可以直接发给 Windows / Linux 用户**。脚本在打包前会逐个校验这套文件是否齐全
（外加 `extension.js` / `webview.js` / `o200k_base.js`），缺任何一个就中止发布。

#### 与更新通道的衔接

扩展内的 `update-check.ts` 读 `releases/latest` 并下载其中的 `.vsix` 资产，
因此脚本必须发布成**正式** Release（非 draft / 非 prerelease），且 tag 去掉 `v`
前缀后要与 `package.json` 的 `version` 完全一致 —— 版本错位会让用户永远看到
「有新版本」却装不上。脚本在读版本、查重、`--verify-tag` 三处都做了校验。

### 修复发布脚本在 Windows 上完全无法运行

Node 出于安全考虑（CVE-2024-27980）拒绝 `spawnSync` 直接执行 `.cmd` / `.bat`，
Windows 上会立刻以 `EINVAL` 失败 —— 而这个脚本最常跑在 Windows（Cursor 所在机器）。
改用 `process.execPath` + 包内 JS 入口调用 CLI，三个平台走同一条代码路径。

---

## 0.0.16 — Web Tools 修复

改动集中在 **Web Search / Web Tools** 这一块。

### 修复 Web Search 静默失败（核心修复）

**现象**：搜索返回了看似正常、实际毫无价值的「结果」，例如：

```text
About DuckDuckGo    duckduckgo.com
/lite               duckduckgo.com
here                duckduckgo.com
```

**根因**（三层叠加）：

| # | 问题 | 说明 |
|---|---|---|
| 1 | **反爬页未被识别** | DuckDuckGo 对抓取请求返回 **HTTP 202 + 人机验证页**。而 `202` 属于 2xx 区间，`response.ok` 为 `true`，旧代码完全察觉不到异常 |
| 2 | **兜底正则抓错东西** | 主正则匹配不到结果节点时，会回退到「抓取页面所有 `<a>` 链接」。于是在验证页上把 `About DuckDuckGo` / `/lite` / `here` 这几个**导航链接**当成了搜索结果返回给模型 |
| 3 | **兜底无视配置** | `catch` 分支**硬编码**调用 DuckDuckGo，即使该 provider 在配置里是 `enabled: false` 也照样调用 |

**修复**：

- 显式判断 `status === 202`，以及页面是否含 `Select all squares containing a duck`
  等挑战页特征，命中即抛错
- **删除**了「抓取全页链接」的危险兜底分支
- 兜底逻辑改为尊重配置开关，并新增 `fallbackToDuckDuckGo` 开关（默认 `true`，可关闭）
- 失败时抛出包含 provider 名称与原因的可读错误，而不是静默返回垃圾数据

### 搜索服务商支持自定义 Base URL

Tavily 的 API 地址原本是**硬编码**的 `https://api.tavily.com/search`，无法指向
自建中转 / 代理网关。

- `SearchProviderEntry` 新增 `baseUrl?: string` 字段
- `searchTavily()` 改为 `searchTavily(apiKey, term, max, baseUrl?)`，支持地址覆盖
  并自动去除尾部斜杠
- 面板中 Tavily 卡片新增 **Base URL** 输入框（留空则走官方地址）

### 新增 Test connection

走的是与真实搜索**完全相同的代码路径**（`searchWithProvider`），因此能一并验证
地址可达性、Key 有效性、响应结构能否被正确解析：

- 成功：`OK — N result(s) in Xms via <endpoint>`
- 失败：红色文字显示具体原因（连接不通 / 401 / 配额 / 0 结果等）

### 精简搜索服务商列表

面板中搜索侧由 6 个精简为 2 个：

| 保留 | 移除 |
|---|---|
| Tavily（主力，支持 Base URL） | Exa |
| DuckDuckGo（兜底开关） | Brave Search |
| | Jina |
| | Firecrawl |

> 移除的仅是**面板入口与默认配置项**，`web.ts` 中各 provider 的实现代码
> （`searchExa` / `searchBrave` / `searchJina` / `searchFirecrawl`）**保持原样保留**，
> 仍可通过直接编辑 `~/.ccursor/web-tools.json` 使用。

### 抓取（Fetch）改为 Tavily，默认启用

**问题**：内置抓取（supermarkdown）是**本机直连**的，遇到 Cloudflare 挑战页必定失败。
实测 `https://linux.do/t/topic/1957183/1912` 稳定返回：

```text
HTTP/2 403
cf-mitigated: challenge
server: cloudflare
title: Just a moment...
```

换 UA（Chrome / curl / Googlebot）都是 403，与请求头无关 —— 是站点侧的人在验证。

**改动**：Fetch 侧由 `builtin | jina | firecrawl` 精简为 `builtin | tavily`，
**默认 `tavily`**：

| 保留 | 移除 |
|---|---|
| **Tavily Extract（默认）** | Jina Reader（无 key 免费档，出口 IP 已被限流，实测工具内直接 403） |
| Built-in（零配置兜底） | Firecrawl（同样依赖外部服务，功能被 Tavily 覆盖） |

Tavily Extract 的请求从 Tavily 服务端出口发出，因此能穿透上述挑战页。

#### 实现要点

- **必须用 `extract_depth: "advanced"`**。默认的 basic 档位对 linux.do 会直接返回
  `Failed to fetch url`，实测稳定复现
- **自动识别 Discourse 论坛 JSON**。抓 `https://<forum>/t/topic/<id>.json` 时，
  Tavily 返回的是原始 JSON（一页 20 帖约 90–135KB），直接透传会被 10 万字符上限
  截断，且 `cooked` 字段全是 HTML 转义。现在会还原成带楼层号的 markdown：

  ```markdown
  # Cursor++ 轻指南

  ## #1 — 楼主 (2026-04-13)
  （楼主正文，用 post.raw 原始 markdown）

  ## #2 — 回复者 (2026-04-13)
  （回复正文）
  ```

- **分页抓取**：Discourse 主题每页 20 帖，加 `?page=N` 即可翻页（该帖共 1947 楼
  ≈ 95 页）。实测连续 12 页 **12/12 成功**，单次请求约 3 秒
- **两层回退**：未填 key 时回退内置抓取；Tavily 调用失败时也回退内置抓取并在日志留
  `[WEB] tavily fetch failed; falling back to builtin`。避免「配了 Tavily 反而连
  普通站点都抓不了」

  但回退会掩盖真实故障：Base URL 配错或服务不可达时，用户只会看到内置抓取的 403，
  误以为「Tavily 没生效」。因此**两者都失败时会把两个原因一起抛出**：

  ```text
  Tavily fetch failed: connect ECONNREFUSED 10.66.66.66:8181.
  Built-in fallback also failed: HTTP 403 Forbidden
  ```

- **配置复用**：Tavily 抓取**不单独存 key**，而是复用 Search 标签页里 Tavily 那一项的
  `apiKey` 与 `baseUrl` —— 两者是同一个账号，分开配置会让用户重复填写，也容易两边
  填成不同的 key。未配置时显示黄色警告，说明当前会回退到内置抓取

- **老配置归一化**：遗留的 `fetch.jina` / `fetch.firecrawl` 以及已下线的 provider 值，
  在读取时会被自动归一化（`normalizeFetchProvider`）为默认值，不需要手动清理

### 其他

- 新增 `WebToolsConfig.search.fallbackToDuckDuckGo` 字段（配置存储读写已同步）
- 面板新增测试按钮与结果提示的样式
- 修复 `Cursor++/pnpm-workspace.yaml` 中 `allowBuilds` 的占位符
  （原值为 `set this to true or false`，会导致 `pnpm run vsix` 直接失败）
- 修复 `protocol.test.ts` 的既有失败：测试 fixture 缺 `source` 字段导致用户规则被
  归类为 always 规则（该用例在改动前就无法通过）
