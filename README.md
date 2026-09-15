<p align="center">
  <img src="ccursor.png" width="120" alt="Cursor++" />
</p>

<h1 align="center">CCursor-BYOK</h1>

<p align="center">
  <strong>Cursor++ (BYOK for Cursor IDE) 的个人二改版</strong><br/>
  重点修复 Web Search 静默失败，并为搜索服务商加入自定义 Base URL（中转站）支持
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

改动集中在 **Web Search / Web Tools** 这一块，共 13 个文件。

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

### 5. 其他

- 新增 `WebToolsConfig.search.fallbackToDuckDuckGo` 字段（配置存储读写已同步）
- 面板新增测试按钮与结果提示的样式
- 版本号 `0.0.15` → `0.0.16`
- 修复 `Cursor++/pnpm-workspace.yaml` 中 `allowBuilds` 的占位符（原值为 `set this to true or false`，会导致 `pnpm run vsix` 直接失败）

### 改动文件清单

```text
Cursor++/package.json                             |   2 +-
Cursor++/pnpm-workspace.yaml                      |   3 +
Cursor++/src/server/config/searchConfigStore.ts   |   1 +
Cursor++/src/server/data/defaults.ts              |  21 ++++-
Cursor++/src/server/handlers/agent/web.ts         | 118 ++++++++++++++++++----
Cursor++/src/ui/components/search-section.tsx     |  57 ++++++++++--
Cursor++/src/ui/components/styles.ts              |   7 ++
Cursor++/src/ui/panel-provider.ts                 |  23 +++++
Cursor++/src/ui/state.ts                          |   2 +-
Cursor++/src/ui/webview/app.ts                    |  29 ++++++
installer/package.json                            |   2 +-
installer/package-lock.json                       |   6 +-
installer/src/defaults.js                         |   7 +-
13 个文件，+232 / -46
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

### `web-tools.json` 示例（使用自建中转）

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
        "baseUrl": "http://your-relay-host:8181"
      },
      { "id": "default-ddg", "type": "duckduckgo", "enabled": false }
    ],
    "parallel": false,
    "maxResults": 10,
    "fallbackToDuckDuckGo": true
  },
  "fetch": { "provider": "builtin" }
}
```

- `baseUrl` 留空或省略 → 使用官方 `https://api.tavily.com`
- `fallbackToDuckDuckGo` 设为 `false` → 搜索失败时直接报错，不做任何兜底

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
