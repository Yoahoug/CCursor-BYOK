<p align="center">
  <a href="README.md">English</a> | 中文
</p>

<p align="center">
  <img src="ccursor.png" width="120" alt="Cursor++" />
</p>

<h1 align="center">CCursor-BYOK</h1>

<p align="center">
  <strong>使用自己的 API Key 驱动 Cursor 的 Agent / Chat / Composer</strong><br/>
  Cursor++（BYOK for Cursor IDE）的个人二改版
</p>

<p align="center">
  <a href="https://github.com/Yoahoug/CCursor-BYOK/releases/latest"><img src="https://img.shields.io/github/v/release/Yoahoug/CCursor-BYOK?label=release" alt="Release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="License" /></a>
  <a href="https://github.com/CometixSpace/CCursor"><img src="https://img.shields.io/badge/upstream-Cursor%2B%2B%200.0.15-lightgrey" alt="Upstream" /></a>
</p>

---

## 这是什么

[CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)（**Cursor++**）的第三方二改版。
沿用上游架构 —— 在 Cursor 扩展宿主里跑一个本地 BYOK 服务，拦截 ConnectRPC / REST 流量，
把 LLM 请求转发到你配置的服务商 —— 并把我在日常使用中确实踩到问题的地方重做了一遍。

| | |
|---|---|
| 上游项目 | <https://github.com/CometixSpace/CCursor> |
| 上游作者 | CometixSpace |
| 上游许可证 | AGPL-3.0-or-later |
| 分叉自 | 上游 `0.0.15` |
| 本项目版本 | `0.0.26` |
| 维护者 | [@Yoahoug](https://github.com/Yoahoug)（非上游作者） |

上游完整功能介绍与架构说明见
[README_UPSTREAM_CN.md](./README_UPSTREAM_CN.md)（中文）·
[README_UPSTREAM.md](./README_UPSTREAM.md)（English）。
下面每一项改动连同其根因都记录在 [CHANGELOG.md](./CHANGELOG.md) 里。

> **免责声明**
> 本项目与 CometixSpace 无关，也不是官方分发渠道。这里改动的正确性与稳定性由我个人负责，
> 请不要把它们当作上游问题去提 issue。想要上游功能与官方支持，请直接使用上游仓库。

---

## 二改内容

按模块分组。每一条都是在沿用上游 `0.0.15` 基础上的改动，而非上游既有特性。

### Web 搜索与抓取

| 改动 | 为什么 |
|---|---|
| **修复 Web Search 静默失败** | DuckDuckGo 对抓取请求返回 **HTTP 202 + 人机验证页**。`202` 属于 2xx，`response.ok` 为 `true`，看上去毫无异常。而兜底分支会去抓**页面上所有 `<a>` 链接**，于是把 `About DuckDuckGo` / `/lite` / `here` 这些导航链接当成搜索结果喂给了模型。现在会识别人机验证页并抛错；「抓取全页链接」这段危险兜底已**删除**，兜底也改为尊重 `enabled` 开关而非硬编码 DuckDuckGo。 |
| **搜索与抓取支持自定义 Base URL** | Tavily 的地址原本是硬编码的，无法指向自建中转 / 代理网关。现在可在面板里配置；抓取侧复用搜索侧那一项的 Key 与地址，不必填两遍。 |
| **新增 Test connection** | 走的是与真实搜索**完全相同**的代码路径（`searchWithProvider`），因此一次就能验证地址可达性、Key 有效性与响应解析 —— 而不只是「端口开着」。 |
| **抓取默认改为 Tavily Extract** | 内置抓取从本机直连出口，遇到 Cloudflare 挑战页必定失败（`linux.do` → `HTTP/2 403`、`cf-mitigated: challenge`；换 Chrome / curl / Googlebot UA 都是 403）。Tavily 从服务端出口发起，能穿透。 |
| **Discourse JSON 还原为 Markdown** | 抓 `https://<forum>/t/topic/<id>.json` 时返回的是原始 JSON（一页 20 帖约 90–135KB），原先会被 10 万字符上限截断，且 `cooked` 字段全是 HTML 转义。现在还原成带楼层号的 Markdown，并支持 `?page=N` 分页（实测 1947 楼的长帖连续 12/12 页成功）。 |
| **两层回退，并同时报告两个失败原因** | 未填 Key 或 Tavily 调用失败时回退内置抓取 —— 但 Base URL 配错时，用户只会看到内置抓取的 403，误以为「Tavily 没生效」。现在两者都失败会把两个原因一起抛出。 |
| **精简服务商列表** | 搜索 6 → 2，抓取 3 → 2。移除的仅是**面板入口与默认配置项**，各 provider 的实现（`searchExa` / `searchBrave` / `searchJina` / `searchFirecrawl`）原样保留，仍可通过直接编辑 `~/.ccursor/web-tools.json` 使用。 |
| **老配置读取时自动归一化** | 已下线的 `fetch.jina` / `fetch.firecrawl` 等值会被自动映射为当前默认值，不需要手动清理。 |

### 服务商与协议处理

| 改动 | 为什么 |
|---|---|
| **协议从「中转站级」下沉到「模型级」** | 一个中转站（一个地址、一个 Key）几乎总会同时挂 `gpt` / `gemini` / `grok` / `glm` / `deepseek`，各家走各的接口形态 —— 而分流是中转站内部做的。用户既无法判断「这个中转站属于哪一类协议」，也不该为了同一个地址建好几条 provider 记录、把密钥重复填。协议现在落在 `ProviderModel.type` 上。 |
| **地址只填前缀，版本段由协议补全** | 两个 SDK 对 `/v1` 的要求正好相反，导致「一个 baseURL」**不可能同时喂对** Anthropic 与 OpenAI 模型：带 `/v1` 则 Anthropic 变成 `/v1/v1/messages`；不带则 OpenAI 打到 `/chat/completions` 而中转站实际是 `/v1/chat/completions`，直接 404。现在只填地址前缀，请求路径按模型各自拼对。老配置里多余的版本段会被剥掉而不是拼两遍。 |
| **模型连通性测试** | 发一次真实请求，走与正式调用**完全相同的代码路径**（地址拼接、鉴权、参数装配、SSE 解析），因此测通基本就等于能用。提示词是为测量设计的 —— 让模型「输出 1 到 120」能产生约 600 token 稳定输出，而纯 ping 只有一两个 token，算出的 tokens/s 会被首字延迟完全淹没。thinking 模型记**两个**首字指标，因为它第一个事件是思考 token 而非正文。 |
| **协议一键探测** | 模型名与接口形态之间没有可靠对应关系（`glm-4.6` 两种路径都可能），只有打一发真实请求才知道。Auto-detect 逐个协议串行试（避免触发限流），把「当前生效协议」放第一个试，返回能通的那个并写回配置。 |
| **推导规则只保留一处** | `src/shared/providerProtocol.ts`。服务端不重复实现，否则两边会悄悄分叉成「界面说 Anthropic、实际请求走 OpenAI」。 |

### 用量仪表盘

| 改动 | 为什么 |
|---|---|
| **新增 `~/.ccursor/usage-stats.jsonl` 与仪表盘** | 每完成一轮追加一条记录，据此算出缓存命中率、每日趋势、按模型与中转站归因。 |
| **主打指标是缓存命中率** | 要回答的问题是「我的中转站有没有真的在做前缀缓存」，而不是笼统的 token 总量。 |
| **各协议 token 口径统一归一化** | 各协议对「输入 token」的定义并不一致 —— anthropic 的 `input_tokens` **不含**缓存读写，而 OpenAI 的 `prompt_tokens` 与 Gemini 的 `promptTokenCount` **已包含**缓存命中。直接相加会把 anthropic 少算、把 OpenAI 重复计入。 |
| **归因用稳定的 `providerId`** | 显示名可以被用户改；改名后原先会把同一个中转站的历史拆成两行、命中率也被拆散。 |
| **按「今日 / 全部累计」拆分** | 原先只有一个总量，其口径是「最近 14 天」却没有任何说明，读起来像「全部累计」，还会随窗口滚动悄悄缩水。现在 `today`（本地时区）、`allTime`、`window`（14 天，供趋势与分模型表格）一趟算出并各自标注。 |
| **修复图表悬浮提示闪出空盒子** | 「关闭」与「清空」是同一个动作，于是 120ms 淡出期间 `x-text` / `x-for` 已无数据：盒子缩到 `min-width` + padding，`left` 回落到 `50%`，在图表正中央闪出一个空盒子再消失。 |

### 更新与发布

| 改动 | 为什么 |
|---|---|
| **更新检测改走本仓库的 GitHub Release** | 原先查的是 npm 上的 `@cometix/ccursor`，并提示执行 `npx @cometix/ccursor update` —— 这条命令装的是**官方版**，会把二改的地方整个覆盖掉。现在读取本仓库的 Release（仓库 public、匿名可读、不需要 token），提供 **Update Now**（下载 Release 里挂着的 `.vsix`，解压后就地覆盖）、**Release Notes** 与 **Later**。 |
| **面板内新增「Check for Updates」按钮** | 原先只有后台定时检查的弹窗这一条路径。按钮一次点击完成「检查 → 有则安装」，标签随过程变化（`Checking…` / `Updating to x.y.z…`），唯一数据源避免文字与实际状态不一致。 |
| **修复 Windows 上更新 100% 失败** | 解压写死了 `unzip`，而 Windows 10+ 自带的是 bsdtar（`tar`）**没有** `unzip`，于是更新在解压这一步以 ENOENT 失败。现在按平台选择命令并互相兜底。`installer/` 与 `scripts/release.mjs` 一直是这么做的，只有扩展内的更新器漏了。 |
| **本地一键发布** | 移除线上 CI / release 工作流（构建机没有 Cursor，原生模块问题难以在远端复现）。`node scripts/release.mjs` 负责构建 → 打包 → 更新本地扩展 → 打 tag → 推送 → `gh release create`。 |
| **默认同步更新本地扩展，并保留备份** | 只发 Release 会让本机继续跑旧代码 —— 本仓库正好踩过这个坑，而且版本号没变会把它藏起来。本地安装排在 push **之前**，好让「装不上」在产生公开 Release 之前就暴露。旧版本备份到 `~/.ccursor/backups/`（保留最近 3 份），刻意不选重启即清空的 `/tmp`。 |
| **修复发布脚本在 Windows 上完全无法运行** | Node 拒绝 `spawnSync` 执行 `.cmd` / `.bat`（CVE-2024-27980），直接报 `EINVAL` —— 而这恰恰是 Cursor 最主要运行的平台。所有 CLI 统一改为 `process.execPath` + 包内 JS 入口调用。 |

### 界面与交互

| 改动 | 为什么 |
|---|---|
| **浮层改用真正的毛玻璃，而不是「4% 的墨」** | 浮层复用了 `--cpp-surface`，而它是「当前前景色 + 4% 不透明度」—— 作为卡片底色没问题，作为浮层底则近乎透明：底下文字直接透上来，与选项交错在一起。现在浮层底改为主题的 `editorWidget` 背景加背景模糊。 |
| **弹窗与悬浮面板改为不透明** | 弹窗本来就盖在既有内容之上，透明只会帮倒忙 —— 表单的标签透上来与弹窗自身文字重影。阴影也改为纯黑，因为深色主题下 `--cpp-ink` 接近白色，原先是「发光」而不是投影。 |
| **协议分段控件改为一行居中** | 三段式控件是 `flex-direction: column`，每段约 60px 宽时 `Anthropic Messages` 会折成两行，按钮高度因此参差不齐。现在单行居中，标签用短名、全名放进悬浮提示。 |
| **仪表盘指标卡重排** | `Cache Write` 显示的是 `nonCachedInputTokens` —— 与命中率卡片下方那个 `4.2M new` 是同一个量，等于把一份数据画了两遍，其中一份还标着 `est.`。删掉这张卡，改为明确的 **Prompt total**（缓存读取 + 未命中输入）。 |
| **修复密码框旁图标不显示** | 图标来自 Cursor 自己的 `codicon.ttf`，它位于扩展目录**之外**，因此必须声明进 `localResourceRoots` —— 注意该字段一旦设置就会**替换**默认值，扩展目录也得一并列出。缺了它字体请求被拦、静默回落到系统字体，私有区码位就渲染成缺字方块。 |
| **模型列表支持拖动排序** | Cursor 的模型选择器按 `providers.json` 里的数组顺序渲染，常驻使用的模型应该排前面。真正重排的是实际数组（走正常的 draft → dirty → save 流程），不是只改视图；插入位置由卡片中线决定而不是鼠标移动方向，且只在放下时才动数组，拖拽过程中列表不会在光标下重排。 |
| **上游模型列表显示可读名** | 部分中转站会把 id 混淆到看不出是什么（例如 `flash` 反写成 `hsalf`），只列 id 等于没法选。现在主行显示 `display_name`，真实 id 在下方以等宽字体呈现。顺带修掉三处解析缺口：只读了 camelCase 的 `displayName`（该中转站返回 snake_case，于是可读名整个丢失）、时间戳只按秒处理、`{ data: [...] }` / `{ models: [...] }` 外层未拆。 |
| **危险操作加二次确认** | 删除中转站 / 移除模型现在要先确认，并说明影响范围。 |

### 稳定性、性能与安全

来自一次全仓库审查（报告见 [AUDIT.md](./AUDIT.md)）。结论是既有设计站得住，
改动集中在安全守卫、可证明的性能热点与静默失败三类。

| 改动 | 为什么 |
|---|---|
| **修复 WebFetch 的私网地址守卫漏判** | `isValidUrl` 拿 `new URL().hostname` 与字面量比较，但该字段对 IPv6 返回的是**带方括号**的形式，尾点也保留：`http://[::1]/` → `"[::1]"`、`http://[::ffff:127.0.0.1]/` → `"[::ffff:7f00:1]"`、`http://[fd00::1]/`、`http://localhost./`。「WebFetch 不许抓本机与内网」这条守卫在上面所有写法下**整个失效**。反方向也错 —— 对 hostname 直接跑 `/^(10\.\|127\.)/` 会把 `10.example.com` 这类普通域名误判成内网。现在先归一化主机名（剥方括号、去尾点），只有真正的 IPv4 字面量才参与网段判断，IPv4-mapped IPv6 先还原成点分十进制，并补齐 `fc00::/7`、`fe80::/10`、`100.64/10`、`169.254/16` 与整段 `127/8`。 |
| **消除 skill frontmatter 正则的二次回溯** | `/^---\s*\n([\s\S]*?)\n---/` 里的 `\s` 包含 `\n`，于是 `\s*` 与紧随其后的 `\n` 争抢同一批换行。这段代码跑在扩展宿主进程的**同步**路径上，而 SKILL.md 的长度不受控：一份损坏的 40KB 文件要 **254ms**。现在降到 **0.02ms**，合法文件无退化。修复必须是单个 `\n` 而不是 `\n+`，否则回溯只是换了地方。 |
| **context breakdown 提速 97%** | `buildContextBreakdown` 对 system prompt、每个工具 schema、preamble 的每一段**分别**调 `countTokens`，而这些内容在同一会话的每轮之间逐字节相同，却每轮重新 encode 一遍（44KB 的 system prompt 单次约 0.9ms）。加了一层**有界 LRU**（上限 500，防止长会话吃内存），稳态路径从 **13.8ms 降到 0.55ms**。 |
| **静默失败补日志** | 跳过无法解码的 blob 原先不留任何痕迹，用户只会看到「上下文莫名其妙变短了」。现在会 `logger.warn` 并带上 `undecodableBlobs` 计数；画布目录损坏同理。其余 19 处被审查的 `catch` 均已确认属于可见失败，无需改动。 |
| **无界内存与 TDZ 隐患** | blob 内存缓存没有上限，而 `cleanupBlobCache()` 没有任何调用方，且每个 blob 都是一整条消息体（带工具结果时可达数百 KB）—— 现在超过 1 万条即触发清理。`waitForMessageMatching` 的 `cleanup` 引用了尚未初始化的 `const timer`，会在「无超时、监听器同步触发」这条路径上抛 `ReferenceError`。 |
| **把 `handlers/` `services/` `database/` 纳入 lint** | 这几个目录原先被整体排除，导致约 9000 行核心 agent 逻辑不受检查 —— 这是仓库里最大的静态分析盲区。现在只保留一处局部豁免：工具描述模板字符串里的字面量前导 Tab。**同时修掉一个门禁陷阱**：`pnpm run lint` 在 `VSCODE_PID` 存在时会静默关掉部分规则，所谓「0 errors」部分是假的；带上 `CI=true` 才是完整规则集。 |
| **结构拆分与测试** | `conversationRuntime.ts`（1316 行）拆出 `contextBreakdown` / `editStreamExtractor` / `editStreamDiagnostics`；`parseRunRequest.ts` 拆出 `protocol/mcpNormalization.ts`；webview 的纯函数搬出 `app.ts`。每处拆分都是先纯搬运、再改逻辑，分两个提交。测试从 442 增至 506，把上面每处修复都钉住。 |
| **一处撤回，已记录原因** | 把 patch header 正则改写为 `[^\S\n]+` 看着更安全，实际破坏了真实输入：原写法中 `\s` 能匹配 `\n`，因此 `File:` 后直接跟换行时仍能解析出路径，而改写在 40 万条随机输入里有 53428 条会匹配不到。性能也持平，于是保留原写法并加上局部 lint 豁免。 |

### 开发

`npm run dev:ui` 用**真实**的 `panel-provider`、webview 代码、配置存储、用量统计与模型测试
在浏览器里跑面板，只替换宿主层（`vscode` 模块、`acquireVsCodeApi`、以及会抢占端口的 `src/server`）。
原先验证一处界面改动要走完整的「构建 → 覆盖扩展目录 → 重启」循环，调间距和配色实际上没法迭代。
预览脚本及其产物不会打进 VSIX。

### 已知边界

- **动态 DNS 域名**（如 `127.0.0.1.nip.io`）仍能绕过私网守卫，且重定向后的最终地址没有二次校验。
  这是既有缺口，本次未使其变差，但 SSRF 防护仍不完整。
- **本次修复只覆盖扩展本体**。`installer/src/patch-*.js`（对 Cursor 本身的注入）未作改动。

---

## 安装

### 注意：不要直接把 VSIX 拖进去

本扩展有**两**部分，把 VSIX 拖进 Cursor 只完成了一半：

| 组成 | 内容 | 能否靠拖 VSIX 完成 |
|---|---|---|
| 扩展本体 | `cursor2plus` 的扩展文件 | 否。它只会落进用户扩展目录 `~/.cursor/extensions/`，而 Cursor 需要的是**安装**目录下的 `resources/app/extensions/` |
| **三处 patch** | 修改 `workbench.desktop.main.js`、`workbench.glass.main.js`、`extensionHostProcess.js`，并同步更新 `product.json` 里这三个文件的 SHA256 校验值 | 否，**完全不会执行** |

缺少 patch 时扩展等于不生效 —— 请求根本到不了 BYOK 服务；
而过期的 `product.json` 校验值还会让 Cursor 报「安装已损坏」。

**请使用安装器。**

### 方式一：完整安装本二改版

```bash
# 1. 克隆
git clone https://github.com/Yoahoug/CCursor-BYOK.git
cd CCursor-BYOK

# 2. 装依赖（Cursor++ 用 pnpm，installer 用 npm）
cd Cursor++ && pnpm install && cd ..
cd installer && npm install && cd ..

# 3. 构建扩展 → 打包 VSIX → 构建 CLI
cd installer && npm run build:all && cd ..

# 4. 安装（先完全退出 Cursor）
node installer/dist/cli.cjs install

# 5. 确认安装状态
node installer/dist/cli.cjs status
```

> 从上游切过来时，先 `node installer/dist/cli.cjs uninstall` 再 `install`。
> `uninstall` 会从备份还原被 patch 的 Cursor 文件，且**要求 Cursor 已完全关闭**，
> 否则文件被占用会直接失败。

### 方式二：只替换扩展本体（增量，最省事）

如果你只改了 `Cursor++/src/` 下的东西（搜索逻辑、面板界面），没动
`installer/src/patch-*.js`，那就不需要卸载重装。

好处是**不用关 Cursor**，也不会碰已有的 patch：

```bash
node scripts/release.mjs --local-only
```

它会构建 → 打包 → 就地覆盖本地扩展目录（旧版本备份到 `~/.ccursor/backups/`），
不提交、不推送、不发 Release，因此可以反复执行。重启 Cursor 生效。
从 `0.0.26` 起，也可以用面板里的 **Check for Updates** 按钮从已发布的 Release 拉取同样的更新。

<details>
<summary>手动操作的方式</summary>

```powershell
# 构建
cd <repo>\installer
npm run build:all

# 解压 VSIX 并覆盖扩展目录
$vsix = "<repo>\installer\vsix\cursor2plus-<version>.vsix"
$tmp  = "$env:TEMP\ccursor-ext"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Copy-Item $vsix "$tmp\v.zip"
tar -xf "$tmp\v.zip" -C $tmp

# 目标目录（按你的实际安装路径调整）
$target = "$env:LOCALAPPDATA\Programs\cursor\resources\app\extensions\cursor2plus"
robocopy "$tmp\extension" $target /E
```

> **注意**：Windows 上原生模块（`dist\supermarkdown.win32-x64-msvc.node` 等）可能被运行中的
> Cursor 占用而复制失败。若字节未变则无影响，`robocopy` 报 `ERROR 32` 可以忽略。

</details>

### 方式三：上游官方安装器

不想要二改、只想用上游：

```bash
npx @cometix/ccursor install
npx @cometix/ccursor status    # 查看状态
npx @cometix/ccursor uninstall # 卸载并还原
```

> 这条命令装的是**上游官方版**，不含本仓库的任何改动。反过来，如果你已经在用本二改版，
> **不要**用它来更新 —— 会把改动整个覆盖掉。请用方式一或方式二。

---

## 配置

配置文件位于 `~/.ccursor/`：

| 文件 | 用途 |
|---|---|
| `providers.json` | 中转站（Base URL + Key）与模型定义 |
| `web-tools.json` | 搜索 / 抓取服务商配置 |
| `routes.json` | BYOK 开关与重定向白名单 |
| `usage-stats.jsonl` | 每轮用量记录，仪表盘的原始数据 |

三份配置文件都能在 Cursor++ 侧边栏面板里可视化编辑；需要批量改动或备份还原时直接编辑文件更省事。

### `providers.json`

**中转站的 `baseUrl` 应填裸域名 / 端口，不要带 `/v1`、`/v1beta` 等版本段。**
版本段与请求路径由该模型生效的协议决定：

| 协议 | 实际请求路径 |
|---|---|
| Anthropic Messages | `<前缀>/v1/messages` |
| OpenAI Chat Completions | `<前缀>/v1/chat/completions` |
| OpenAI Responses | `<前缀>/v1/responses` |
| Gemini | `<前缀>/v1beta/models/<model>:streamGenerateContent` |

这正是同一个前缀下各家模型都能拼对的原因，也是协议落在「模型级」而不是「中转站级」
的原因（一个中转站通常同时挂 gpt / gemini / glm / claude）。

> 前缀里已经带了版本段不会被拼两遍（`.../v1` + Anthropic → `.../v1/messages`），
> 老配置可继续使用。真正要注意的是把**完整端点**当前缀填进来（例如 `.../v1/messages`），
> 那样路径会被拼两遍。

### `web-tools.json`

```json
{
  "$schemaVersion": 1,
  "search": {
    "providers": [
      {
        "id": "default-tavily",
        "type": "tavily",
        "enabled": true,
        "apiKey": "your-api-key",
        "baseUrl": "https://api.tavily.com"
      },
      { "id": "default-ddg", "type": "duckduckgo", "enabled": false }
    ],
    "parallel": false,
    "maxResults": 10,
    "fallbackToDuckDuckGo": true
  },
  "fetch": { "provider": "tavily" }
}
```

- `search.providers` —— 面板提供 Tavily（支持自定义 `baseUrl`）与 DuckDuckGo（免费兜底，常被反爬拦截）
- `baseUrl` 留空或省略 → 走官方 `https://api.tavily.com`
- `fallbackToDuckDuckGo: false` → 失败时直接报错，不回退
- `fetch.provider` —— `tavily`（默认，复用上面 Tavily 的 Key 与 Base URL）或 `builtin`
  （本机直连抓取，抓不了 Cloudflare 防护的站点）

---

## 更新

扩展会定期（最长 4 小时）检查本仓库的 GitHub Release。有新版本时会提供
**Update Now**（下载 Release 里的 `.vsix` 并就地覆盖扩展目录，**之后需重启 Cursor**）、
**Release Notes** 与 **Later**（忽略该版本）。

不想等的话，面板 **Config** 页底部、`Edit Routes` / `Edit providers.json` 下方有一个
**Check for Updates** 按钮：点一下即完成「检查 → 有则安装」，过程与结果都在面板内提示。
按钮进行中会变成 `Checking…` / `Updating to x.y.z…` 并暂时禁用，避免重复触发。

更新渠道完全由本仓库控制，不依赖 npm 上是否存在同名包。

<details>
<summary>维护者：如何发版</summary>

把改动写进 [`CHANGELOG.md`](./CHANGELOG.md)，然后：

```bash
node scripts/release.mjs --bump patch       # 升版本 → 构建 → 打包 → 更新本地 → 推送并发布
node scripts/release.mjs --local-only       # 只构建 + 更新本地，不提交、不推送、不发 Release
node scripts/release.mjs --dry-run          # 只构建 + 校验，什么都不写
node scripts/release.mjs --no-install       # 只发布，不动本机扩展
```

脚本依次执行：前置检查 → 版本一致性 → 类型检查 / lint / 单测 → 生产构建 →
多平台产物校验 → 打包 VSIX → 更新本地扩展 → 提交版本号 / 打 tag / 推送 / `gh release create`。

两条约定：

1. **`Cursor++/package.json` 与 `installer/package.json` 的版本必须一致** —— 用 `--bump` 时脚本会一起升。
2. **发版前工作区必须干净** —— 脚本只会提交这两个 `package.json`。

需要 `gh` CLI 已登录（`gh auth status`）。`--local-only` 不需要，也不要求工作区干净。

产物包含 macOS / Linux / Windows（x64 · arm64）各平台的原生模块，因此在任一平台构建出的
VSIX 都能发给其他平台的用户。

</details>

---

## 排障

| 现象 | 处理 |
|---|---|
| 安装后无法登录 | 在侧边栏面板把 BYOK **关掉**，正常登录后再打开 |
| 提示找不到模型 | 在侧边栏面板添加模型，或编辑 `~/.ccursor/providers.json` |
| LLM 返回 401 / 403 / 404 | 检查 Key 与 Base URL。注意 Base URL 填的是**前缀** —— 填成完整端点会导致路径被拼两遍 |
| 搜索返回一堆无意义的导航链接 | 已在 `0.0.16` 修复；确认你跑的不是更旧的构建 |
| 某些站点抓取 403 | 这些站点在 Cloudflare 后面。配置 Tavily Key，并让 `fetch.provider` 保持 `tavily` |
| Cursor 运行中更新失败 | 原生模块可能被占用。完全退出 Cursor 后重跑即可；已写入的文件会跳过，不会重复。`0.0.26` 起 Windows 上不再卡在解压这一步 |
| 更新后面板毫无变化 | 扩展目录里的 JS 已加载进内存，**重启 Cursor** |

---

## 文档

| 文件 | 内容 |
|---|---|
| [CHANGELOG.md](./CHANGELOG.md) | 每项改动连同根因与被放弃的方案 |
| [AUDIT.md](./AUDIT.md) | `0.0.23` 改动背后的全仓库审查报告 |
| [README_UPSTREAM_CN.md](./README_UPSTREAM_CN.md) · [English](./README_UPSTREAM.md) | 上游功能列表与架构说明 |

---

## 上游

完整功能列表、架构说明与通用排障请见上游：

- 仓库：<https://github.com/CometixSpace/CCursor>
- npm：<https://www.npmjs.com/package/@cometix/ccursor>

---

## 许可证

AGPL-3.0-or-later，承自上游 —— 见 [LICENSE](./LICENSE)。

按 AGPL 要求，本二改版以同一许可证发布。
