<p align="center">
  <img src="ccursor.png" width="120" alt="Cursor++" />
</p>

<h1 align="center">CCursor-BYOK</h1>

<p align="center">
  <strong>Cursor++ (BYOK for Cursor IDE) 的个人二改版</strong><br/>
  重点修复 Web Search 静默失败、为搜索服务商加入自定义 Base URL（中转站）支持，<br/>
  并把 Web Fetch 切换为 Tavily（可穿透 Cloudflare 挑战页）
</p>

---

## 这是什么

本项目是 [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)（Cursor++）的**第三方修改版（fork / 二改版）**。

- **上游项目**：<https://github.com/CometixSpace/CCursor>
- **上游作者**：CometixSpace
- **上游许可**：AGPL-3.0-or-later
- **本项目基于版本**：`0.0.15`
- **本项目版本**：`0.0.16`
- **维护者**：[@Yoahoug](https://github.com/Yoahoug)（非上游作者）

> **免责声明**
> 本项目与上游作者 CometixSpace 无隶属关系，也不是官方发布渠道。
> 所有改动的正确性、稳定性由本项目自行承担，请勿向上游项目提交与本二改相关的 issue。
> 如需上游原始功能与官方支持，请直接使用上游仓库。

---

## 我改了什么

改动集中在 **Web Search / Web Tools** 这一块，并新增了一套打包/发布工作流。

### 1. 修复 Web Search 静默失败（核心修复）

**问题现象**：搜索返回了看似正常、实际毫无价值的"结果"，例如：

```text
About DuckDuckGo    duckduckgo.com
/lite               duckduckgo.com
here                duckduckgo.com
```

**根因**（三层叠加）：

| # | 问题 | 说明 |
|---|---|---|
| 1 | **反爬页未被识别** | DuckDuckGo 对抓取请求返回 **HTTP 202 + 人机验证页**。而 `202` 属于 2xx 区间，`response.ok` 为 `true`，旧代码完全察觉不到异常。 |
| 2 | **兜底正则抓错东西** | 主正则匹配不到结果节点时，会回退到"抓取页面所有 `<a>` 链接"。于是在验证页上把 `About DuckDuckGo` / `/lite` / `here` 这几个**导航链接**当成了搜索结果返回给模型。 |
| 3 | **兜底无视配置** | `catch` 分支**硬编码**调用 DuckDuckGo，即使该 provider 在配置里是 `enabled: false` 也照样调用。 |

**修复方式**：

- 显式判断 `status === 202`，以及页面是否含 `Select all squares containing a duck` 等挑战页特征，命中即抛错
- **删除**了"抓取全页链接"的危险兜底分支
- 兜底逻辑改为尊重配置开关，并新增 `fallbackToDuckDuckGo` 开关（默认 `true`，可关闭）
- 失败时抛出包含 provider 名称与原因的可读错误，而不是静默返回垃圾数据

### 2. 搜索服务商支持自定义 Base URL

Tavily 的 API 地址原本是**硬编码**的 `https://api.tavily.com/search`，无法指向自建中转/代理网关。

- `SearchProviderEntry` 新增 `baseUrl?: string` 字段
- `searchTavily()` 改为 `searchTavily(apiKey, term, max, baseUrl?)`，支持地址覆盖并自动去除尾部斜杠
- 面板中 Tavily 卡片新增 **Base URL** 输入框（留空则走官方地址）

### 3. 新增「Test connection」连通性测试

在面板中一键验证当前 Key + Base URL 是否可用。

走的是与真实搜索**完全相同的代码路径**（`searchWithProvider`），因此能一并验证：地址可达性、Key 有效性、响应结构能否被正确解析。结果分为：

- 成功：`OK — N result(s) in Xms via <endpoint>`
- 失败：红色文字显示具体原因（连接不通 / 401 / 配额 / 0 结果等）

### 4. 精简搜索服务商列表

面板中搜索侧由 6 个精简为 2 个：

| 保留 | 移除 |
|---|---|
| Tavily（主力，支持 Base URL） | Exa |
| DuckDuckGo（兜底开关） | Brave Search |
| | Jina |
| | Firecrawl |

> 注：移除的仅是**面板入口与默认配置项**，`web.ts` 中各 provider 的实现代码（`searchExa` / `searchBrave` / `searchJina` / `searchFirecrawl`）**保持原样保留**，仍可通过直接编辑 `~/.ccursor/web-tools.json` 使用。

### 5. 抓取服务商（Fetch）改为 Tavily，默认启用

**问题**：内置抓取（supermarkdown）是**本机直连**的，遇到 Cloudflare 挑战页必定失败。实测 `https://linux.do/t/topic/1957183/1912` 稳定返回：

```text
HTTP/2 403
cf-mitigated: challenge
server: cloudflare
title: Just a moment...
```

换 UA（Chrome / curl / Googlebot）都是 403，与请求头无关——是站点侧的人在验证。

**改动**：Fetch 侧由 `builtin | jina | firecrawl` 精简为 `builtin | tavily`，**默认 `tavily`**：

| 保留 | 移除 |
|---|---|
| **Tavily Extract（默认）** | Jina Reader（无 key 免费档，出口 IP 已被限流，实测工具内直接 403） |
| Built-in（零配置兜底） | Firecrawl（同样依赖外部服务，功能被 Tavily 覆盖） |

Tavily Extract 的请求从 Tavily 服务端出口发出，因此能穿透上述挑战页。

#### 关键实现细节

- **必须用 `extract_depth: "advanced"`**。默认的 basic 档位对 linux.do 会直接返回 `Failed to fetch url`，实测稳定复现。
- **自动识别 Discourse 论坛 JSON**。抓 `https://<forum>/t/topic/<id>.json` 时，Tavily 返回的是原始 JSON（一页 20 帖约 90–135KB），直接透传会被 10 万字符上限截断，且 `cooked` 字段全是 HTML 转义。现在会还原成带楼层号的 markdown：

```markdown
# Cursor++ 轻指南 v0.0.15

## #1 — Haleclipse (2026-04-13)
（楼主正文，用 post.raw 原始 markdown）

## #2 — 一摩尔氚 (2026-04-13)
（回复正文）
```

- **分页抓取**：Discourse 主题每页 20 帖，加 `?page=N` 即可翻页（该帖共 1947 楼 ≈ 95 页）。实测连续 12 页 **12/12 成功**，单次请求约 3 秒。
- **两层回退**：未填 key 时回退内置抓取；Tavily 调用失败时也回退内置抓取并在日志留 `[WEB] tavily fetch failed; falling back to builtin`。避免"配了 Tavily 反而连普通站点都抓不了"。
  - 但回退会掩盖真实故障：Base URL 配错或服务不可达时，用户只会看到内置抓取的 403，误以为"Tavily 没生效"。因此**两者都失败时会把两个原因一起抛出**：

```text
Tavily fetch failed: connect ECONNREFUSED 10.66.66.66:8181.
Built-in fallback also failed: HTTP 403 Forbidden
```

#### 配置复用（重点）

Tavily 抓取**不单独存 key**，而是**复用 Search 标签页里 Tavily 那一项的 `apiKey` 与 `baseUrl`**：

- 两者是同一个 Tavily 账号，分开配置会让用户重复填写，也容易两边填成不同的 key
- `baseUrl` 留空则走官方 `https://api.tavily.com`；若使用第三方/私有端点，**必须在 Search 标签页填好 `Base URL`**，否则请求会发往官方地址并因 key 不匹配而 401
- Fetch 标签页会实时显示当前实际使用的地址，并提供 **Edit in Search tab** 按钮直接跳转
- 未配置时显示黄色警告，说明当前会回退到内置抓取、且内置抓取无法访问 Cloudflare 站点

`web-tools.json` 的 `fetch` 段因此只剩一个字段：

```json
"fetch": { "provider": "tavily" }
```

> 老配置里遗留的 `fetch.jina` / `fetch.firecrawl` 以及已下线的 provider 值，在读取时会被自动归一化（`normalizeFetchProvider`）为默认值，不需要手动清理。

#### Fetch 侧也新增了 Test connection

与搜索侧一致，走真实 `fetchTavily` 路径（含 `advanced` 参数）探活，用 `example.com` 作为稳定探测目标：

- 成功：`OK — N chars in Xms via http://10.66.66.66:8181/extract`
- 失败：红色文字显示具体原因（key 为空 / 401 / 配额 / 返回空正文）

### 6. 更新检测改走本仓库，不再走官方

**问题**：原 `update-check.ts` 查的是 npm 上的 `@cometix/ccursor`，并提示执行 `npx @cometix/ccursor update`。这条命令装的是**官方版**，会把二改的地方（Tavily Fetch、Search 修复等）整个覆盖掉。

**改动**：

- 检测源改为本仓库的 GitHub Release（`Yoahoug/CCursor-BYOK`）。仓库是 public，匿名可读，不需要 token
- 弹出提示时提供 **Update Now**：直接下载 Release 里挂着的 `.vsix`，解压后就地覆盖当前扩展目录，完成后提示重启 Cursor
- 另给 **Release Notes**（跳转该版本 Release 页）与 **Later**（该版本不再提醒）两个选项

更新包的下载地址取自 Release 资产而非 npm，因此**不依赖 npm 上是否存在同名包**——发布通道完全由本仓库掌控。

### 7. 打包与发布工作流

新增三个 GitHub Actions 工作流 + 一套本地门禁，形成「本地先验证 → 线上才打包」的链路。

#### 本地门禁（提交前强制）

```bash
cd Cursor++ && node scripts/verify.mjs
```

依次跑 **类型检查 → lint → 单元测试 → 生产构建**，任一失败即非零退出。已通过 `git pre-commit hook` 接入，**提交前自动执行，不通过就拒绝提交**。

安装 hook（clone 后执行一次）：

```bash
node scripts/install-hooks.mjs
```

> hook 脚本本身放在 `scripts/pre-commit` 并纳入版本控制，`.git/hooks/` 只是副本 —— 因为 `.git/` 不进版本库，直接写在那里的话换机器就静默失效了。
> 确有需要时可 `git commit --no-verify` 绕过。

#### `ci.yml` —— 远端复验

push 到 `main` / 开 PR 时跑**同一份** `scripts/verify.mjs`。与本地 hook 共用一套通过标准，因此不会出现「本地绿、CI 红」的偏差。CI 独立复验是必要的：hook 可以被 `--no-verify` 绕过，协作者也可能没装 hook。

#### `release.yml` —— 打 tag 自动打包发布

```bash
# 1. 先把两个 package.json 的版本号改好（必须与 tag 一致）
# 2. 打 tag 推送
git tag v0.0.17
git push origin v0.0.17
```

工作流会：

1. `checkout` 该 tag
2. **再跑一遍完整门禁**（tag 可能打在历史提交上，且发出去的产物值得单独验证）
3. `vsce package` 产出 `.vsix`
4. 校验 **tag 与 `Cursor++/package.json` 版本一致**，不一致直接失败
5. 创建 Release 并挂上 `.vsix` 资产

> 版本一致性检查是有意加的：更新检测靠比较 `tag` 与扩展内版本号，两者错位会让用户永远看到「有新版本」。

用 tag 触发而不是 push main 自动发版：一次 Release 就是对外的「一个可用版本」，应由人显式决定，否则每次修字都会发版、刷屏更新提示。

#### `upstream-watch.yml` —— 每日检测官方更新

每天北京时间 09:00 检查上游 `CometixSpace/CCursor` 是否发布了比本地更高的版本，有则**开一个 issue** 提醒。

**为什么只提醒、不自动合并**：上游改动可能落在本仓库二改过的同一批文件上（尤其是 `web.ts`），自动合并会冲掉二改逻辑或留下难以察觉的语义冲突。issue 里会列出**需要重点核对的文件清单**与合并步骤，决策留给人。

> 注意版本方向：上游目前是 `0.0.14`，本仓库 `0.0.16`（二改版领先）。工作流只在**上游更高**时才提醒，不会因为「版本号不同」就误报。

### 8. 其他

- 新增 `WebToolsConfig.search.fallbackToDuckDuckGo` 字段（配置存储读写已同步）
- 面板新增测试按钮与结果提示的样式
- 版本号 `0.0.15` → `0.0.16`
- 修复 `Cursor++/pnpm-workspace.yaml` 中 `allowBuilds` 的占位符（原值为 `set this to true or false`，会导致 `pnpm run vsix` 直接失败）
- 修复 `protocol.test.ts` 的既有失败：测试 fixture 缺 `source` 字段导致用户规则被归类为 always 规则（该用例在改动前就无法通过，会阻塞新引入的提交门禁）

### 改动文件清单

```text
.github/workflows/ci.yml                          | new
.github/workflows/release.yml                     | new
.github/workflows/upstream-watch.yml              | new
scripts/install-hooks.mjs                         | new
scripts/pre-commit                                | new
Cursor++/scripts/verify.mjs                       | new
Cursor++/package.json                             |   4 +-
Cursor++/src/update-check.ts                      | 重写（走本仓库 Release + 一键更新）
Cursor++/src/extension.ts                         |   2 +-
Cursor++/src/server/tests/protocol.test.ts        |   9 +-
Cursor++/src/server/config/searchConfigStore.ts   |  22 +++-
Cursor++/src/server/data/defaults.ts              |  45 ++++++-
Cursor++/src/server/handlers/agent/web.ts         | 165 +++++++++++++++++++----
Cursor++/src/ui/components/search-section.tsx     |  84 ++++++++++---
Cursor++/src/ui/components/styles.ts              |  12 ++
Cursor++/src/ui/panel-provider.ts                 |  46 +++++++
Cursor++/src/ui/state.ts                          |   2 +-
Cursor++/src/ui/webview/app.ts                    |  60 +++++++-
Cursor++/src/server/tests/webFetchProvider.test.ts | new
Cursor++/src/server/tests/webFetchLive.test.ts     | new
installer/package.json                            |   2 +-
installer/package-lock.json                       |   6 +-
installer/src/defaults.js                         |   9 +-
```

---

## 如何安装

### 重要：不能拖拽 VSIX 安装

这个项目由**两部分**组成，拖 VSIX 只能完成一半：

| 组件 | 内容 | 拖 VSIX 能做到吗 |
|---|---|---|
| 扩展本体 | `cursor2plus` 扩展文件 | ❌ 只会装进用户扩展目录 `~/.cursor/extensions/`，而它需要的是 Cursor 安装目录下的 `resources/app/extensions/` |
| **三处补丁** | 修改 `workbench.desktop.main.js`、`workbench.glass.main.js`、`extensionHostProcess.js`，并更新 `product.json` 中这三个文件的 SHA256 校验和 | ❌ **完全不做** |

补丁未生效时，扩展形同摆设——搜索请求根本不会路由到 BYOK 服务器；且 `product.json` 校验和不匹配还会让 Cursor 报"安装已损坏"。

**因此必须使用安装器。**

### 方式一：使用上游官方安装器（推荐普通用户）

本二改版的修复也已同步进本地构建产物，但若你只想使用上游功能，直接用官方安装器即可：

```bash
npx @cometix/ccursor install
npx @cometix/ccursor status    # 检查状态
npx @cometix/ccursor uninstall # 卸载还原
```

### 方式二：安装本二改版（本地构建）

由于本仓库是二改版，**不要**再用 `npx @cometix/ccursor`——那会下载并安装上游官方版，你的改动不会生效。

```bash
# 1. 克隆本仓库
git clone https://github.com/Yoahoug/CCursor-BYOK.git
cd CCursor-BYOK/installer

# 2. 安装依赖
cd ../Cursor++ && pnpm install && cd ../installer && npm install

# 3. 一键构建（构建扩展 → 打包 VSIX → 构建 CLI）
npm run build:all

# 4. 安装（需先完全退出 Cursor）
node dist/cli.cjs install
```

> 若已装过上游版本，需先 `node dist/cli.cjs uninstall` 再 `install`。
> `uninstall` 会从备份还原被修改的 Cursor 文件，**执行前必须完全退出 Cursor**，否则文件被占用会导致失败。

### 方式三：只替换扩展本体（增量更新，最省事）

如果你**只修改了 `Cursor++/src/` 下的内容**（如搜索逻辑、面板 UI），而 `installer/src/patch-*.js`（对 Cursor 本身的注入逻辑）未改动，则无需走完整的卸载重装，只替换扩展目录即可。

好处是**无需关闭 Cursor**，也不触碰已打好的补丁：

```powershell
# 构建
cd <repo>\installer
npm run build:all

# 解压 VSIX 并覆盖扩展目录
$vsix = "<repo>\installer\vsix\cursor2plus-0.0.16.vsix"
$tmp  = "$env:TEMP\ccursor-ext"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Copy-Item $vsix "$tmp\v.zip"
tar -xf "$tmp\v.zip" -C $tmp

# 目标目录（请按你的实际安装路径调整）
$target = "$env:LOCALAPPDATA\Programs\cursor\resources\app\extensions\cursor2plus"
robocopy "$tmp\extension" $target /E

# 重启 Cursor 生效
```

> **注意**：Windows 上 `dist\supermarkdown.win32-x64-msvc.node` 等原生模块可能被正在运行的 Cursor 占用而无法覆盖。
> 若新旧文件内容一致（未改动依赖）则完全无影响；`robocopy` 报 `ERROR 32` 时可忽略。

---

## 配置

配置文件位于 `~/.ccursor/`：

| 文件 | 用途 |
|---|---|
| `web-tools.json` | 搜索 / 抓取服务商配置（本项目主要改动对象） |
| `providers.json` | LLM 服务商与模型定义 |
| `routes.json` | BYOK 开关与重定向白名单 |

### `web-tools.json` 示例

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

- `baseUrl` 留空或省略 → 使用官方 `https://api.tavily.com`
- `fallbackToDuckDuckGo` 设为 `false` → 搜索失败时直接报错，不做任何兜底
- `fetch.provider` 可选 `tavily`（默认，复用上面 Tavily 的 key / baseUrl）或 `builtin`（本机直连，无法访问 Cloudflare 站点）

以上配置也可直接在 Cursor++ 侧边栏面板的 **Web Tools** 中可视化修改。

---

## 上游项目

关于 Cursor++ 的完整功能介绍、架构说明与一般性故障排查，请参阅上游仓库：

- 仓库：<https://github.com/CometixSpace/CCursor>
- npm：<https://www.npmjs.com/package/@cometix/ccursor>

---

## 许可

沿用上游的 **AGPL-3.0-or-later**，详见 [LICENSE](./LICENSE)。

依据 AGPL，本二改版同样以该许可开源发布。
