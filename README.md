<p align="center">
  <img src="ccursor.png" width="120" alt="Cursor++" />
</p>

<h1 align="center">CCursor-BYOK</h1>

<p align="center">
  <strong>Cursor++（BYOK for Cursor IDE）的个人二改版</strong><br/>
  在 Cursor 里用自己的 API Key / 中转站驱动 Agent
</p>

---

## 这是什么

本项目是 [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)（Cursor++）的
**第三方修改版（fork / 二改版）**。

| | |
|---|---|
| 上游项目 | <https://github.com/CometixSpace/CCursor> |
| 上游作者 | CometixSpace |
| 上游许可 | AGPL-3.0-or-later |
| 本项目基于 | 上游 `0.0.15` |
| 本项目版本 | `0.0.24` |
| 维护者 | [@Yoahoug](https://github.com/Yoahoug)（非上游作者） |

上游 Cursor++ 的完整功能介绍与架构说明见 [README_UPSTREAM_CN.md](./README_UPSTREAM_CN.md)
（英文版 [README_UPSTREAM.md](./README_UPSTREAM.md)）。

> **免责声明**
> 本项目与上游作者 CometixSpace 无隶属关系，也不是官方发布渠道。
> 所有改动的正确性、稳定性由本项目自行承担，请勿向上游项目提交与本二改相关的 issue。
> 如需上游原始功能与官方支持，请直接使用上游仓库。

---

## 我改了什么

相对上游的主要改动概览。每一条的起因、根因分析与实现细节见 [CHANGELOG.md](./CHANGELOG.md)。

**Web Tools —— 搜索与抓取**

- **修复 Web Search 静默失败**（核心修复）—— DuckDuckGo 的反爬页返回 **HTTP 202**，落在 2xx 区间被 `response.ok` 判为成功，于是人机验证页上的 `About DuckDuckGo` / `/lite` / `here` 等导航链接被当成搜索结果喂给了模型。现在会识别挑战页特征并抛错，删除了「抓取全页链接」的危险兜底，兜底也不再无视 provider 的 `enabled` 开关。
- **搜索 / 抓取支持自定义 Base URL** —— Tavily 地址原先硬编码为官方端点，无法指向自建中转站。现可在面板填写；抓取侧复用搜索侧的 key 与地址，不必重复配置。
- **抓取默认改用 Tavily Extract** —— 内置抓取由本机直连发起，遇 Cloudflare 挑战页必被 403（换 Chrome / curl / Googlebot 的 UA 均无效），Tavily 从服务端出口发起可穿透；另支持把 Discourse 论坛 JSON 还原成带楼层号的 markdown。
- **服务商列表精简** —— 搜索 6 → 2，抓取 3 → 2。移除的仅是**面板入口与默认配置项**，实现代码保持原样，仍可通过手写 `~/.ccursor/web-tools.json` 使用。

**Provider 配置**

- **协议由「中转站级」下沉到「模型级」** —— 一个中转站（一个地址、一个 Key）通常同时挂 gpt / gemini / glm / deepseek，各家接口形态不同，而分流在中转站内部完成。协议现挂在模型上，未手动选择时按模型名推导并固化进配置。
- **地址只填前缀，版本段由协议补全** —— Anthropic 与 OpenAI 两边 SDK 对 baseURL 该不该带 `/v1` 的要求**正好相反**，因此一个 baseURL 不可能同时喂对两家模型。现在只填前缀，版本段与请求路径按生效协议拼接；老配置里多余的版本段会被自动剥掉，而非拼成 `/v1/v1/messages`。
- **模型连通性测试与协议自动探测** —— 面板内发一次真实请求探活（与正式调用走同一条代码路径），Auto-detect 可逐个协议试出该模型实际可用哪一种。

**可观测性与发布**

- **用量统计仪表盘** —— 缓存命中率、每日趋势、按模型与中转站归因。各协议对「输入 token」的口径不同（Anthropic 不含缓存读写，OpenAI / Gemini 已含 cached 子集），落统计前统一归一化。
- **更新检测改走本仓库 Release** —— 原检测指向 npm 上的官方版，其更新命令会把二改整个覆盖掉；现读取本仓库 Release 并支持一键下载安装。
- **发布改为本地一键构建** —— 移除线上构建链路（`release.yml` / `ci.yml`），改用 `node scripts/release.mjs` 完成构建 → 打包 → 更新本机扩展 → 推送发布，默认同步本地，保证「发出去的版本 = 本机在跑的版本」。

**界面**

- 浮层改毛玻璃（原背景在浮层上等于全透明）、协议选择器一行居中、指标卡重排，并删掉与命中率口径重复的冗余卡片。

---

## 安装

### 重要：不能拖拽 VSIX 安装

这个项目由**两部分**组成，拖 VSIX 只能完成一半：

| 组件 | 内容 | 拖 VSIX 能做到吗 |
|---|---|---|
| 扩展本体 | `cursor2plus` 扩展文件 | ❌ 只会装进用户扩展目录 `~/.cursor/extensions/`，而它需要的是 Cursor 安装目录下的 `resources/app/extensions/` |
| **三处补丁** | 修改 `workbench.desktop.main.js`、`workbench.glass.main.js`、`extensionHostProcess.js`，并更新 `product.json` 中这三个文件的 SHA256 校验和 | ❌ **完全不做** |

补丁未生效时，扩展形同摆设 —— 请求根本不会路由到 BYOK 服务器；且 `product.json`
校验和不匹配还会让 Cursor 报「安装已损坏」。

**因此必须使用安装器。**

### 方式一：安装本二改版（完整安装）

```bash
# 1. 克隆本仓库
git clone https://github.com/Yoahoug/CCursor-BYOK.git
cd CCursor-BYOK

# 2. 装依赖（Cursor++ 用 pnpm，installer 用 npm）
cd Cursor++ && pnpm install && cd ..
cd installer && npm install && cd ..

# 3. 构建扩展 → 打包 VSIX → 构建 CLI
cd installer && npm run build:all && cd ..

# 4. 安装（需先完全退出 Cursor）
node installer/dist/cli.cjs install
```

> 若已装过上游版本，需先 `node installer/dist/cli.cjs uninstall` 再 `install`。
> `uninstall` 会从备份还原被修改的 Cursor 文件，**执行前必须完全退出 Cursor**，
> 否则文件被占用会导致失败。

### 方式二：只替换扩展本体（增量更新，最省事）

如果你**只修改了 `Cursor++/src/` 下的内容**（如搜索逻辑、面板 UI），
而 `installer/src/patch-*.js`（对 Cursor 本身的注入逻辑）未改动，
则无需走完整的卸载重装，只替换扩展目录即可。

好处是**无需关闭 Cursor**，也不触碰已打好的补丁。仓库里已带一键脚本：

```bash
node scripts/release.mjs --local-only
```

它会完成构建 → 打包 → 覆盖本机扩展目录（并备份旧版本到 `~/.ccursor/backups/`），
但不提交、不推送、不发 Release，可以反复跑。重启 Cursor 后生效。

<details>
<summary>想手工操作（不跑脚本）</summary>

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

# 目标目录（请按你的实际安装路径调整）
$target = "$env:LOCALAPPDATA\Programs\cursor\resources\app\extensions\cursor2plus"
robocopy "$tmp\extension" $target /E
```

> **注意**：Windows 上 `dist\supermarkdown.win32-x64-msvc.node` 等原生模块可能被正在运行的
> Cursor 占用而无法覆盖。若新旧文件内容一致（未改动依赖）则完全无影响；
> `robocopy` 报 `ERROR 32` 时可忽略。

</details>

### 方式三：使用上游官方安装器

若你不需要本二改版，只想用上游原版：

```bash
npx @cometix/ccursor install
npx @cometix/ccursor status    # 检查状态
npx @cometix/ccursor uninstall # 卸载还原
```

> 这条命令装的是**上游官方版**，本仓库的改动**不会**包含在内。
> 反之，如果你已经装了本二改版，**不要**用它来更新 —— 会把二改的地方整个覆盖掉。
> 本二改版请用方式一 / 方式二。

---

## 配置

配置文件位于 `~/.ccursor/`：

| 文件 | 用途 |
|---|---|
| `web-tools.json` | 搜索 / 抓取服务商配置 |
| `providers.json` | 中转站（Base URL + Key）与模型定义 |
| `routes.json` | BYOK 开关与重定向白名单 |

以上三项都可在 Cursor++ 侧边栏面板里可视化编辑，手改文件适合批量调整或备份恢复。

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

- `search.providers` —— 面板里可选 Tavily（支持自定义 `baseUrl`）与 DuckDuckGo（免费兜底，
  但常被反爬拦下）
- `baseUrl` 留空或省略 → 使用官方 `https://api.tavily.com`
- `fallbackToDuckDuckGo` 设为 `false` → 搜索失败时直接报错，不做任何兜底
- `fetch.provider` —— `tavily`（默认，复用上面 Tavily 的 key / baseUrl）或
  `builtin`（本机直连，无法访问 Cloudflare 站点）

### `providers.json`

**中转站的 `baseUrl` 只填到域名 / 端口即可，不要带 `/v1`、`/v1beta` 这类版本段。**
版本段与请求路径由每个模型各自生效的协议决定，会自动补全：

| 协议 | 实际请求路径 |
|---|---|
| Anthropic Messages | `<前缀>/v1/messages` |
| OpenAI Chat Completions | `<前缀>/v1/chat/completions` |
| OpenAI Responses | `<前缀>/v1/responses` |
| Gemini | `<前缀>/v1beta/models/<model>:streamGenerateContent` |

因此同一个前缀下挂不同厂商的模型，各自都能拼对地址 —— 这也是**协议挂在模型上、
而不是中转站上**的原因（一个中转站通常同时挂着 gpt / gemini / glm / claude）。
面板里为每个模型选好协议即可；没手动选过的会按模型名推导，并在保存前固化进配置。

> 前缀里若已带该协议的版本段，不会被重复拼接（`.../v1` + Anthropic → `.../v1/messages`），
> 老配置可以继续用。真正的坑是**把完整端点当前缀填进来**（如 `.../v1/messages`），
> 那样路径会拼两遍。

---

## 更新

扩展会定期检查本仓库的 GitHub Release。检测到新版本时会提示：

- **Update Now** —— 自动下载该 Release 的 `.vsix` 并就地覆盖扩展目录，完成后**需重启 Cursor**
- **Release Notes** —— 跳转该版本的 Release 页
- **Later** —— 该版本不再提醒

发布通道完全由本仓库掌控，不依赖 npm 上是否存在同名包。

<details>
<summary>维护者：如何发版</summary>

改动记录写进 [`CHANGELOG.md`](./CHANGELOG.md)，然后：

```bash
node scripts/release.mjs --bump patch       # 升版本 → 构建 → 打包 → 更新本地 → 推送发布
node scripts/release.mjs --local-only       # 只构建 + 更新本地，不推送、不发 Release
node scripts/release.mjs --dry-run          # 只构建 + 校验，不写本地、不推任何东西
node scripts/release.mjs --no-install       # 只发版，不动本机扩展
```

脚本会依次做：前置检查 → 版本一致性 → typecheck / lint / 单测 → 生产构建 →
多端产物校验 → 打包 VSIX → 更新本地扩展 → 提交版本号 / 打 tag / 推送 / `gh release create`。

两个约定：

1. **`Cursor++/package.json` 与 `installer/package.json` 的版本必须一致**，脚本按 `--bump` 同步升版
2. 发布前**工作区必须干净** —— 脚本只提交这两个 `package.json`

前置条件：`gh` CLI 已登录（`gh auth status`）。`--local-only` 不需要，也不要求工作区干净。

产物内含 macOS / Linux / Windows（x64 · arm64）全部原生模块，因此在任意平台构建出的
VSIX 都能直接发给其他平台使用。

</details>

---

## 上游项目

关于 Cursor++ 的完整功能介绍、架构说明与一般性故障排查，请参阅上游仓库：

- 仓库：<https://github.com/CometixSpace/CCursor>
- npm：<https://www.npmjs.com/package/@cometix/ccursor>

---

## 许可

沿用上游的 **AGPL-3.0-or-later**，详见 [LICENSE](./LICENSE)。

依据 AGPL，本二改版同样以该许可开源发布。
