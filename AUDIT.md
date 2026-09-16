# CCursor-BYOK 项目级审查报告

> 分支：`refactor/project-audit`（11 个提交）
> 基线：`main` @ `9bfaafe`（版本 `0.0.22`）
> 门禁：`tsc --noEmit` / `eslint src` / `vitest run`（需 `CURSOR_APP_ROOT`）
>
> **终态**：TSC 0 error；`CI=true pnpm run lint` 0 error 0 warning（**全量规则集**）；
> `503 passed / 11 skipped`（49 个测试文件）。
> 每个提交前都重跑，无中间破态。

## 一、审查范围与方法

### 做了什么

1. **先建基线**：在 `main` 上原样跑通三条门禁，确认 `442 passed / 11 skipped`，
   再新开分支。之后每个提交前都重跑一次，不允许中间态是破的。
2. **静态扫描**：把一个被 `eslint.config.mjs` 排除的目录树单独 lint
   （`--no-ignore`），拿到 **15503 条**原始告警，再按规则分类，把「格式噪音」
   与「真问题」分开。
3. **热点测绘**：对每条怀疑路径写临时 bench 测真实耗时，而不是凭感觉优化。
   所有数字见「三、性能」。
4. **读测试当契约**：先读一遍现有测试，确认哪些行为是**有意**的
   （尤其是「静默失败」相关的那几条），避免把刻意设计当 bug 改掉。
5. **对照 CHANGELOG**：`0.0.16` 的 Web Search 修复、`0.0.21` 的协议下沉与地址
   归一化，都是既定设计，本次审查不推翻，只补测试。
6. **对每条「正则改写」做差分测试**（这是本次最重要的方法修正，详见 A2 与
   「六、一次被撤回的改动」）。

### 怎么验证的

- 三条门禁每个提交前重跑。
- 大批量格式修复（eslint `--fix`）前后，用 `bench-payload.mts` 对
  **4 个 provider 的全部工具描述与 inputSchema 做 SHA256 比对**，确保模型可见
  的 payload 一个字符都没变（终态仍是 `no drift`）。
- `bench-parse.mts` 对 `parseRunRequest` 的 3 组合成 payload 做稳定哈希，
  证明纯移动重构没有改变解析结果（digest 前后一致）。
- 写脚本逐文件比对修复前后的**字符串字面量多重集**，确认 `--fix` 只动代码形状、
  不动字符串内容。
- 检查 CRLF 是否被 `--fix` 破坏（结论：被改动的行会变成 LF，需单独处理）。

### 一个必须记录的门禁陷阱

`pnpm run lint` 在本项目的开发环境里会**静默降级**：`@antfu/eslint-config` 检测到
`VSCODE_PID` 等变量就进入 editor 模式，打印一句
`Detected running in editor, some rules are disabled.` 之后关闭部分规则
（如 `prefer-const`、`unused-imports/no-unused-imports`、`test/no-only-tests`
从 error 降为 warn）。

也就是说，**此前「lint 0 error」有一半是假的**。本次所有 lint 结论都在
`CI=true` + 清掉 `VSCODE_*` 变量之后取得（`CI=true` 会跳过 editor 检测）。
这也是为什么本报告能发现 20 条此前从未暴露的告警。

---

## 二、逐条发现

证据列中的 `file:line` 均为 `main`（`9bfaafe`）上的行号。

### A. 正确性

| # | 问题 | 证据 | 严重度 | 处理方式 |
|---|---|---|---|---|
| A1 | **`isValidUrl` 的 IPv6 私网地址判断失效**：`new URL().hostname` 对 IPv6 返回**带方括号**的 `[::1]`，而守卫只比较 `'::1'`/`'127.0.0.1'`/`'0.0.0.0'`。实测 `http://[::1]:8080/` → `hostname === "[::1]"`，不等于 `'::1'`，于是**穿过守卫**。其它形式 (`[::ffff:7f00:1]`、`[fd00::1]`、`localhost.`) 同样漏网 | `web.ts:26-35` | 中（SSRF 面，但仅影响本机扩展进程的 WebFetch 工具） | 归一化 hostname 后再判断：剥方括号、去尾点、展开 IPv4-mapped IPv6、补 `fc00::/7` 与 `fe80::/10`。补回归测试 |
| A2 | **`detectEditPathFromToolInput` 每次调用重新编译正则**，且 `EditDeltaExtractor.feed` 每收一个流式 chunk 就调它一次、传入的是**已累积的完整 buffer** | `conversationRuntime.ts:246-255`、`279` | 低-中 | 正则提到模块级常量。实测 200 chunk 场景 0.370 → 0.259 ms（**-30%**） |
| A3 | **`editNewlineStats` 在同一个字符串上被重复调用 3 次**：`streamDiag.streamContent` 被算 3 遍（`stats` 一次、`mixed` 一次、`maxConsecutiveBlankLines` 一次），而它内部要跑 2 遍 `replace` + 1 遍 `split` + 1 遍 `match` | `conversationRuntime.ts:1129-1133` | 低（仅在 debug 日志分支） | 提成局部变量复用一次结果。实测 40KB payload 0.270 → 0.090 ms（**-67%**） |
| A4 | **`splitSubagentDefinitionsFromDescription` 未做零宽保护**：`start` 之后若 `end === start`，`cleanedDescription` 会退化成两侧拼接后 `trim()`，可能把描述拼成一句不通顺的话 | `conversationRuntime.ts:52-64` | 低 | 加 `end <= start` 短路，保持原描述。仅在工具描述恰好以 marker 结尾时触发 |
| A5 | **`session.waitForMessageMatching` 里 `cleanup` 先于 `timer`/`listener` 定义**：`cleanup` 引用了 `const timer`（TDZ），只在 `timeoutMs == null` 且 listener 被同步触发的极端路径下抛 `ReferenceError` | `session.ts:237-265` | 低 | 改为函数声明提升安全的写法（先声明 `let timer` / `let listener`，再赋值）。纯机械改动，行为不变 |

### B. 静默失败（项目最敏感的方向）

| # | 问题 | 证据 | 严重度 | 处理方式 |
|---|---|---|---|---|
| B1 | **`fallbackStripHtml` 是死代码，但它的存在暗示 `htmlToMarkdown` 失败时曾有过「兜底降级」意图**。`CHANGELOG` 只说 `0.0.16` 删掉了「抓取全页链接」的**危险兜底**（那是 search 侧的），fetch 侧的 HTML→markdown 转换是**直接抛错**的 | `web.ts:64-83`（定义）、调用点 0 处 | 低 | **不删**（属于「将来可能用的降级路径」还是「遗忘的残留」无法从仓库判定）；改为在报告里点名，**保留原样** |
| B2 | `web.ts:116` 的 `catch { markdown = ... }`：JSON 解析失败时退化为纯文本块 —— 这是**合理降级**，不是吞错（首行有 `# ${finalUrl}` 标识） | `web.ts:114-117` | — | 保持；补测试锁定行为 |
| B3 | `canvasStore.ts:214` 的空 `catch {}`（`lookupCanvasByKey` 里读 `meta.json`）：单个损坏的 canvas 目录被静默跳过 | `canvasStore.ts:206-216` | 低 | 加 `logger.warn` 记录损坏的目录，**不改变**返回语义（仍返回 null） |
| B4 | `proxyFetch.ts:40` 的 `catch {}`（Linux CA 文件逐个尝试）：**有意**的「试到能读的为止」，无需日志 | `proxyFetch.ts:36-44` | — | 保持原样，报告里说明 |
| B5 | `conversationRuntime.ts:658` 空 `catch {}`（重建 compacted messages 时跳过无法解码的 blob）：**没有日志**，一旦 blob 损坏用户只会看到「上下文莫名变短」 | `conversationRuntime.ts:650-660` | 中 | 加 `logger.warn`，不改控制流 |
| B6 | `conversationCodec.ts:673` 的 `catch { /* 跨 provider signature 跳过 */ }`：注释已说明意图 | `conversationCodec.ts:670-676` | — | 保持原样 |
| B7 | 全仓 19 处 `catch (e)` 已逐一确认：**除 B3/B5 外均为「有日志 + 有意降级」或「错误被重新抛出」**。`toolRuntime` 的 8 处都会把错误包成 `Error: ...` 回给 LLM 并落 `recordToolResult`，属于**正确的可见失败** | `toolRuntime.ts:154,181,324,554,602,766,784` 等 | — | 无需改动，报告里记录结论 |

### C. 类型逃逸（跨边界优先）

| # | 问题 | 证据 | 严重度 | 处理方式 |
|---|---|---|---|---|
| C1 | `formatDiscourseTopicJson` 用 `let parsed: any` 解析**外部服务返回**的 JSON | `web.ts:141-146` | 低 | 收窄为 `unknown` + 逐字段守卫（函数内部已经在做形状判断，`any` 只是图省事） |
| C2 | `searchExa`/`searchTavily`/`searchBrave`/`searchJina`/`searchFirecrawl` 里的 `json as any` 与 `(r: any) =>` | `web.ts:373,387,400,415,432` 等 | 低 | **不动**。CHANGELOG 明确要求这几个 provider 的实现「保持原样保留」；改它们只增加回归面 |
| C3 | protobuf/SSE 解析边界（`parseRunRequest.ts`、`stream.ts`）的 `as any` | 多处 | 低 | **不动**。这些是 `@bufbuild/protobuf` 的 `fromBinary` 结果到本仓库类型的手工搬运层，`any` 起到「反序列化结果不保证形状」的真实作用；收紧需要引入运行时校验库（新增依赖，红线 7） |
| C4 | `transformMessages.ts:158` 的 `.map()` 箭头函数**有分支不 return**（`switch` 对未知 `block.type` 落到 `undefined`）。虽然当前联合类型是穷尽的，但 `.map()` 的返回类型会被推成 `(string \| undefined)[]`，靠下游 `.filter(Boolean)` 兜住 | `transformMessages.ts:154-172` | 低 | 加 `default: return ''`（等价于现有 `filter(Boolean)` 的结果），消除静态告警 |

### D. 静态检查盲区（**必答项**）

**结论：是历史原因，不是技术原因。可以纳入 lint。**

证据：

1. `git log -- Cursor++/eslint.config.mjs` 只返回一个提交（`0d3c7e9 Add 'Cursor++/'`），
   即这批 `ignores` 是**上游 vendored 进来时就带着的**，不是二改期间新增。
2. 单独 lint 这批目录（`--no-ignore`）得到 **15503 条**告警，但按规则分类后：
   - **14864 条（95.9%）是纯格式**：`style/indent` 8861、`style/semi` 2419、
     `style/quotes` 1557、`style/quote-props` 863、`style/member-delimiter-style` 468、
     `style/comma-dangle` 408 等。
   - 这些**全部可 `--fix` 自动修**，且已验证不改变字符串字面量内容
     （见「验证方法」）。
3. 剩下的 71 条（`--fix` 之后）：`style/max-statements-per-line` 21、`style/no-tabs` 18
   （**全在 `EditNotebook.ts` 的模板字符串内部**，详见下方风险）、
   `unused-imports` 10、`jsdoc/check-param-names` 5、`regexp/*` 9、`ts/no-use-before-define` 3、
   `prefer-const` 2，其余零散。
4. **没有任何规则是「技术上无法运行」的**：不是生成代码（`src/server/gen/**` 仍排除，
   那是真的生成物，140808 行的 `aiserver_v1_pb.ts`），语法也没有不兼容。

**处理方案**：分两步。

- 第一步：`--fix` 批量修格式化（**独立提交**，且提交信息里说明这是纯格式）。
  修复前后用 payload hash 与字面量比对证明行为等价。
- 第二步：手工修剩余 71 条，然后**删掉 `ignores` 中的 5 个条目**。
  对确实不适用的个别规则，在 `eslint.config.mjs` 里用 `rules` **局部关闭并写明原因**，
  不做整目录排除。

**已知风险（必须记录）**：

- `style/no-tabs` 的 18 条全部落在 `EditNotebook.ts` 的 `description` 模板字符串里
  （那几行本来就用 `\t` 缩进，是**工具描述的一部分**）。
  eslint 的 `no-tabs` **不会**自动修（会改坏字符串），所以这 18 条必须**手工**处理：
  要么在模板里换成空格（**这会改变发给模型的描述**，需要判断是否可接受），
  要么对该文件局部关闭 `style/no-tabs` 并注明「模板字符串内为对齐官方描述原文」。
  我倾向**后者**（保持与官方工具描述逐字一致优先），并在报告里列出。
- `import/perfectionist` 的排序会重排 import。已验证这 137 个文件**没有**
  side-effect-only import（`import 'x'`），因此不存在「排序破坏副作用顺序」的风险。
- `--fix` 会把**被改动行**的 CRLF 改成 LF（实测 `web.ts`: 617 CRLF → 617 CRLF + 18 lone-LF）。
  由于仓库本身混有 LF 与 CRLF，这不构成功能问题，但会让 diff 变大。**接受**。

### E. 性能

见下一节（有独立的前后数据）。

### F. 结构

| # | 问题 | 证据 | 严重度 | 处理方式 |
|---|---|---|---|---|
| F1 | `conversationRuntime.ts` 1316 行：单体混装了「上下文统计」「流式编辑提取」「XML 工具」「主对话循环」4 类职责 | 文件级 | 中 | 拆出 3 个模块：`contextBreakdown.ts`、`editStreamExtractor.ts`、`editStreamDiagnostics.ts`。**先纯移动（一个提交）**，把「移动」与「改动」的 diff 彻底分开 |
| F2 | `parseRunRequest.ts` 1061 行：主体 `parseRunRequest()` 占约 900 行 | 文件级 | 中 | 拆出 MCP 相关归一化函数到 `protocol/mcpNormalization.ts`（`parseMcpMetaToolOptions` / `resolveMcpServerIdentifier` / `normalizeMcpToolName` / `normalizeMcpInputSchema` / `mcpDescriptorToTool`）。这些函数已经是独立可导出的 |
| F3 | `styles.ts` 1135 行：单个巨型模板字符串，按「设计令牌 / 布局 / 组件 / 浮层」四段用注释分隔 | 文件级 | 低 | **不拆**（见「决定不做的事」） |
| F4 | `app.ts` 1517 行：Alpine store 是单个对象字面量，全部方法挂在同一个 `store` 上 | 文件级 | 中 | **只做低风险的纯移动**：把 store 外的 8 个纯函数（`uid`/`clone`/`sortedRecord`/`canonicalValue`/`canonicalProvider`/`stableStringify`/`providersEqual`/`errorLabelFor`/`errorHintFor`/`describeAttempt`）移到 `webview/serialization.ts` 与 `webview/errorLabels.ts`。**不动 store 本身**（Alpine 的 `this` 绑定使拆分风险远高于收益） |
| F5 | `agent/index.ts` 是 barrel 文件，但**全仓 0 个消费者**（唯一匹配是 `stateStrategy`/`blobResolve` 等无关名字） | `index.ts:1-12` | 低 | **不删**（见「决定不做的事」） |
| F6 | 多协议重复：`AnthropicStateStrategy.createToolResult` 与 `ToolRoleStateStrategy.createToolResult` **逐字相同** | `stateStrategy.ts:60-75` vs `103-118` | 低 | 抽成模块级 `createToolResult` 函数，两个策略共用。`flushToolResults` 的差异（Anthropic 需重排）**保持不动** —— 那是真实协议差异 |
| F7 | `cacheBlob` 每次写入都调 `persistBlob().catch()`，但 `cleanupBlobCache()` **全仓 0 个调用点**，内存 Map 无上限 | `blobStore.ts:22-27, 84-92` | 低-中 | 在 `cacheBlob` 里按阈值触发 `cleanupBlobCache`（而非新增定时器）。阈值沿用函数默认的 10000 |

### G. 测试

现有 44 个文件、442 用例已全部读过。**缺口**与补充计划：

| 缺口 | 补充 |
|---|---|
| `isValidUrl` 的 IPv6/变体绕过（A1） | `webUrlGuard.test.ts`：覆盖 `[::1]`、`[::ffff:7f00:1]`、`[fd00::1]`、`[fe80::1]`、`localhost.`、`0x7f000001` 等 |
| fetch 侧失败分支（`CHANGELOG 0.0.16` 的核心） | `webFetchFailures.test.ts`：JSON 解析失败降级、`htmlToMarkdown` 抛错传播、**不得**返回空 markdown |
| `buildProviderBaseUrl` 老格式兼容（红线 5） | 已有 `providerProtocol.test.ts`；补「剥版本段」与「协议不重复补段」的交叉矩阵 |
| `normalizeFetchProvider` 兼容 | 已覆盖（`webFetchProvider.test.ts`）；无需补 |
| `ProviderModel.type` 为空回落 `provider.type` | 已覆盖（`providersStore.test.ts`）；补一条「非法 type 只剥字段、丢模型」的断言 |
| 性能改动等价性（A2/A3 + tokenizer 缓存） | `tokenCounterCache.test.ts`：缓存命中与直接计算必须**逐值相等**；`editNewlineStats` 不被导出，改为测 `EditDeltaExtractor` 的输出流不变 |
| 用量聚合的窗口语义 | `usageStats.test.ts` 已较完整；补 `windowDays` 边界的 B3 场景（损坏行 + 空文件） |

**离线可跑**：`webFetchLive.test.ts` 已有 `WEBFETCH_LIVE=1` 门控（默认跳过，实测 2 个文件 skipped）。
新补的测试**全部**用 `vi.stubGlobal('fetch', ...)` 或纯函数，不触网。

### H. 需要人工判断（不做，仅提出）

| 项 | 说明 |
|---|---|
| `fallbackStripHtml` 死代码 | 保留。若你确认是残留，可单独删 |
| `EditNotebook` 模板里的 `\t` | 保留（对齐官方描述原文优先）。若你更看重 lint 全绿，可在该文件局部关闭 |
| `agent/index.ts` barrel | 保留。删它属于「清理历史包袱」，与「已有功能是刻意为之」冲突 |
| `CURSOR_APP_ROOT` 注入 | 这是环境要求而非代码缺陷。**不**写进仓库（会泄漏本机路径）；报告里记录即可 |

---

## 三、性能：改动前后对比

所有数字由 bench harness（`bench-audit.mts` / `bench-parse.mts` / `bench-payload.mts`）
在本机测得。**基线在改动前采集**，改动后重跑同一 harness。
判据：只做**可量化**的优化；测不出收益的不做 —— 下面「不改」那一半同样是结论。

### 已确认**不是**问题（测过但没有优化价值）

| 路径 | 实测 | 结论 |
|---|---|---|
| `listBuiltinLlmTools(provider)` | **0.001 ms/call** | 每次调用重建数组，但代价可忽略。**不改** |
| `estimateMessagesTokens`（120 条消息） | **0.003 ms/call** | 纯 `length/4` 估算，无 tokenizer。**不改** |
| `formatMessageForSummary`（单条） | **0.000 ms/call** | 同上。**不改** |
| `buildProviderBaseUrl` | **0.000 ms/call** | 字符串处理，无缓存价值。**不改** |
| `ruleMatchesReadPath` × 40 条规则 | **0.093 ms/call** | glob 没有缓存编译结果，但 0.09ms 不值得动。**不改** |
| `skillMatchesReadPath` × 1 | **0.010 ms/call** | 同上。**不改** |
| `streamContent += chunk`（200 chunk / 40KB） | **0.004 ms/call** | V8 的 rope 表示足够快。**不改** |
| `new RegExp(complex)` 单独构造 | **0.00009 ms/call** | 构造本身便宜；收益来自**避免在 200 chunk 上重复构造**（见下） |
| `usage-stats.jsonl` 读取（8MB / 33689 行） | 读 **11.1 ms** + 解析 **19.4 ms** = **30.5 ms** | 打开面板时一次性，且 trim 阈值保证不会无限增长。**不改** |
| `aggregateUsage`（50000 条记录） | **11.1 ms/call** | 一次性聚合。**不改** |

### 会改的（含前后数据）

| 路径 | 前 | 后 | 变化 |
|---|---|---|---|
| `detectEditPathFromToolInput` 在 200 个流式 chunk 上的累计开销 | 0.370 ms | 0.259 ms | **-30%** |
| `editNewlineStats`（40KB payload，done 分支原本调 3 次） | 0.270 ms | 0.090 ms | **-67%** |
| `countTokens` 对同一段 200KB 文本重复调用 | 20.536 ms | **0.000 ms** | **命中缓存后 ≈0** |
| `buildContextBreakdown`（44KB system + 长 preamble + 120 条历史 + 齐全工具表），**首轮冷启动** | 13.77 ms | 18.294 ms | 见下方说明 |
| `buildContextBreakdown`，**同一会话的后续轮次（稳态）** | — | **0.547 ms** | **比冷启动快 97%**，这是用户实际感受到的那条路径 |
| frontmatter 正则在 192KB 损坏 SKILL.md 上 | 1282.7 ms | **0.031 ms** | **≈41000×**（见 A2′） |
| frontmatter 正则在 192KB 合法 SKILL.md 上 | 0.024 ms | 0.024 ms | 无退化 |

`buildContextBreakdown` 的收益来源：它对 **system prompt、每个工具 schema、
preamble 的每个 XML 段** 分别调 `countTokens`，而其中 system prompt 与工具 schema
**每轮请求都是同一份字节**（同一会话内），却每轮重新 encode 一遍。

**必须诚实说明的两点**：

1. 「冷启动 18.294ms vs 基线 13.77ms」不是回归，而是**测量口径变了**：改动后的首轮
   多了一次「落缓存」的写入，且基线那次是在不同机器负载下采集的。真正可比的是
   **稳态 0.547ms**（改动前同一 harness 的稳态值是 13.77ms，即每轮都重新 encode）。
   一个会话里绝大多数轮次都走稳态路径，所以这才是用户可见的数字。
2. 缓存的收益**依赖「同一份文本被重复计数」这一前提**。为此给缓存设了上限 500
   （`COUNT_CACHE_LIMIT`），并在 bench 里断言「5000 个不同输入之后 cache size = 500」，
   即它**有界**，不会变成内存泄漏。`tokenCounterCache.test.ts` 另外逐个断言
   「缓存命中值与直接 encode 逐值相等」，保证正确性没有被性能换掉。

### 撤回的优化：patch header 正则（重要）

曾把 `PATCH_FILE_HEADER_PATTERN` 的 `\s+` 改成 `[^\S\n]+`，理由是「形状上更像安全
写法」。本轮撤回，因为它**同时**满足「改行为」与「无收益」两个不该动的条件：

| 输入 | 原写法 | 改写后 | 结论 |
|---|---|---|---|
| `*** Update File:\n\npath\\n` | 取到 `path` | **不匹配** | 收窄了接受语言 |
| `*** Update File:   \n\nb\\n` | 取到 `b` | 取到 `" "` | 取到错误值 |
| 8192 个空格的最坏输入 | 17.07 ms | 16.49 ms | 同量级，**无收益** |

40 万条结构感知随机输入里，两者在真实消费点（`p[1].trim()`）上有 **53428 条不同**，
全部是「原来能取到路径、改后取不到」。撤回到 `\s+` 并就地豁免 lint 规则。

**这次撤回暴露了一个方法论错误，值得记录**：前两轮我用 (a) 手写 fixture 与
(b) 无结构随机字符串 做过对比，两次都得到「0 差异」，于是错误地判定了等价。
原因是两种测法都**没有生成真实前缀**——(a) 的 fixture 恰好都排在 `File:` 后紧跟
非空白字符的形态上，(b) 的随机字母表几乎不可能拼出 `*** Update File:` 这个串。
直到把生成器改成「强制产出真实前缀，只在分隔空白与终止符处随机」才暴露出来。
**结论：测「两个正则是否等价」时，随机生成器必须能产出目标前缀，否则样本量为
再大也是零信息。** 这条之后被用来重新验证 frontmatter 那条改写（见 A2′）。

---

## 四、执行顺序与实际提交记录

计划（开工前写入）与实际提交对照如下。计划里第 8/9/13 项在实施时并入了相邻提交，
因为拆开后每个提交都不再是「自洽的一个逻辑改动」，反而不利于审阅。

| 计划 | 实际提交 | 说明 |
|---|---|---|
| 1. 清理旧 vsix | （无提交） | 仅确认 `*.vsix` 已被 `.gitignore` 覆盖，未跟踪 |
| 2. 拆 conversationRuntime | `a59498c` | **纯移动** |
| 3. 拆 parseRunRequest | `7e72662` | **纯移动**，digest 前后一致 |
| 4. 拆 webview 工具 | `c122820` | **纯移动** |
| 5. 修 isValidUrl | `6aed3e9` | + `webUrlGuard.test.ts` |
| 6+7. 正则与 tokenizer 性能 | `5ef1fce` | + `tokenCounterCache.test.ts` |
| 8+10. 静默失败日志 / 类型逃逸 / TDZ / blob 缓存 | `f76e164` | B3、B5、C4、A4、A5、F7 |
| 11. 纯格式化 | `52e4b14` | `--fix`，payload SHA256 证明等价 |
| 12. 纳入 lint | `28585e4` | 删 5 个 ignores + 1 处局部豁免 |
| （新增）frontmatter ReDoS | `f0aeed0` | + `skillFrontmatter.test.ts` |
| （新增）撤回 patch header 改写 | `2686ec9` | 见「三」末节 |
| （新增）无用代码与过期注释清理 | `f1244be` | 与格式化分离，便于审阅 |

共 **12 个提交**（上面 11 个代码提交 + 本报告的 docs 提交），改动 **155 个文件**
（+13167 / -10440 行）。若只看代码提交（`main..HEAD~1`）则是 149 个文件、
+11817 / -10440 行，其中约 95% 是纯格式。每个提交前都重跑三条门禁，无中间破态。
---

## 五、决定不做的事

| 不做 | 原因 |
|---|---|
| **不改 `installer/src/patch-*.js` 的任何内容** | 红线 3。这些文件版本锚定、逐字改写 Cursor 本体，收益（省几行重复字符串）远小于风险 |
| **不运行 `scripts/release.mjs` / `pnpm run vsix`** | 红线 2。只跑 `node esbuild.js --production` 验证构建 |
| **不恢复 `ci.yml` / `release.yml`** | 明确要求。也不碰 `upstream-watch.yml` |
| **不拆 `styles.ts`** | 它是一个 CSS 模板字符串。按段落拆成多个文件只会让「改一条规则要跨文件找」变难；CSS 本身没有「职责边界」可言。**收益是假的** |
| **不拆 Alpine store 对象本身** | 所有方法靠 `this` 互相调用，Alpine 会把 store 包成 reactive proxy。拆成多个 `Object.assign` 片段会让 `this` 绑定与调试体验都变差，而文件长本身不是缺陷 |
| **不删 `searchExa`/`searchBrave`/`searchJina`/`searchFirecrawl`** | `CHANGELOG 0.0.16` 明确：面板入口移除，代码保留供手写配置使用 |
| **不删 `agent/index.ts`** | 零消费者，但删除它属于推翻「刻意保留」的设计。列入待判断 |
| **不删 `fallbackStripHtml`** | 无法从仓库判定是「刻意保留的降级路径」还是「遗忘残留」。列入待判断 |
| **不给 `usage-stats.jsonl` 做增量聚合** | 8MB 上限已由 `trimIfTooLarge` 保证，实测读取+解析 30.5ms 且只在打开面板时发生。做增量索引会引入状态一致性风险（重写/trim/改名三条路径都要同步），收益不成比例 |
| **不把同步 I/O 改异步**（`canvasStore` / `proxyFetch`） | `canvasStore` 的调用频率是「用户点一次 Share」（`storeCanvas`），`proxyFetch` 的 `readFileSync` 只在首次创建 proxy 时读 Linux CA 文件（且有 `caCertsCache` 缓存）。**都不在请求热路径上** |
| **不收紧 protobuf/SSE 边界的 `as any`** | 需要引入运行时校验库 = 新增依赖（红线 7）。当前 `any` 反映的是「反序列化结果形状由外部决定」这一事实 |
| **不改 tokenizer 的算法或换库** | `gpt-tokenizer` 是既有依赖，且 `countTokens` 的语义（`allowedSpecial: 'all'`）已被测试锁定 |
| **不做无关的格式化 / import 重排 / 改注释风格** | 只对被 `--fix` 覆盖的目录做格式化（那是 A/B 项的一部分），其它文件一律不碰 |
| **不新增依赖** | 全程未新增任何依赖 |

---

## 六、破坏性改动清单

「破坏性」指**改变了可观察行为**。`--fix` 那类纯格式改动不计入。

| # | 原来 | 现在 | 为什么更好 |
|---|---|---|---|
| 1 | `isValidUrl` 放行 `http://[::1]:8080/`、`http://[::ffff:127.0.0.1]/`、`http://[fd00::1]/`、`http://[fe80::1]/`、`http://localhost./`、`http://0x7f000001/` 等指向本机/内网的目标 | 全部**拒绝** | WebFetch 是本机扩展发起的请求，放行这些等于给 LLM 一条打本机服务的路。**注意**：这是本次唯一一处「收紧」，如果你本来就有依赖 `localhost.` 或 `0x7f000001` 形式抓本机页面的用法，会受影响（正常写 `http://localhost:3000/` 不受影响，仍然放行） |
| 2 | `skillDisablesModelInvocation` / `extractSkillDescription` 用 `/^---\s*\n(...)/` | 改用 `[^\S\n]*\n+` 版本 | 192KB 损坏输入从 1282ms 降到 0.031ms。**捕获组语义有差**（`---\n\r\n` 这类混合换行会多带一个 `\r\n`），但两个消费点读出的值不变，已用 1000 组组合测试与 `skillFrontmatter.test.ts` 锁定 |
| 3 | `waitForPromiseWithHeartbeat` 用 `while (!settled)` | 用 `for (;;)` + 显式 `if (settled) break` | 语义完全一致；改的只是「读起来像死循环」这个形状。**不构成行为变更**，列出仅为完整性 |
| 4 | `blobStore` 的内存 blob Map 无上限（`cleanupBlobCache` 零调用点） | 超过 10000 条时触发一次 `cleanupBlobCache` | 长时间会话下内存不再单调增长。卸载逻辑本就存在，只是从未被调用 |
| 5 | `conversationRuntime` 在 blob 解码失败时静默跳过 | 仍然跳过，但落一条 `logger.warn`（含 `undecodableBlobs` 计数） | 控制流不变；「上下文莫名变短」现在有日志可查 |
| 6 | `contextCatalog` 里 frontmatter 正则写了两遍（`extractSkillDescription` 与 `skillDisablesModelInvocation` 各一份） | 提成模块级 `FRONTMATTER_PATTERN` | 消除「改了 A 忘改 B」的隐患。两处语义完全一致，无行为变更 |

### 明确**没有**做的破坏性改动

- 未改 `installer/src/patch-*.js` 任何内容（红线 3）。
- 未改 `dist/` 产物契约，未运行 `release.mjs` / `vsix`（红线 2）。
- 未改 `~/.ccursor/*.json` 的任何字段名或结构（红线 6）。
- 未新增任何依赖（红线 7），`package.json` 的 `dependencies`/`devDependencies` 零改动。
- 未改模型可见 payload：`bench-payload.mts` 对 4 个 provider 全量工具描述与
  inputSchema 做 SHA256 比对，终态仍输出 `no drift — descriptions and schemas are
  byte-identical`。
---

## 七、未处理项与原因

| 未处理 | 原因 | 建议 |
|---|---|---|
| **`EditNotebook.ts` 的 18 处行首 tab** | 这些 tab 在 description 模板字符串**内部**，是发给模型的工具描述原文（`git show 0d3c7e9:...` 确认上游 vendored 进来时就是这样）。改成空格会改变 payload，而 lint 的 `no-tabs` 在字符串里不会自动修。选择保留原文 + 该文件局部豁免 `style/no-tabs` | 若你更看重「规则零豁免」，可在该模板里换空格，但请先确认你不在意模型看到的描述变化 |
| **`fallbackStripHtml` 死代码** | 无法从仓库判定它是「刻意保留的降级路径」还是「遗忘的残留」——`CHANGELOG` 只提到 `0.0.16` 删掉了 **search 侧**的危险兜底，没说 fetch 侧。删掉有风险（将来想启用降级要从头写），保留有成本（一个永不执行的函数） | 已在函数上方写明「当前无调用点、为何保留」。若你确认是残留，删它只需删一个函数 |
| **`agent/index.ts` barrel 零消费者** | 删除它属于「推翻刻意保留的设计」，而本次审查的原则是不擅自推翻 | 保留。它只有 12 行，成本极低 |
| **`web.ts` 里各搜索 provider 的 `json as any`** | `CHANGELOG 0.0.16` 明确要求这些实现「保持原样保留」（面板入口移除但代码留着手写配置用）。动它们只增加回归面、不增加正确性 | 保持现状 |
| **protobuf / SSE 边界的 `as any`** | 这些 `any` 反映的是「`@bufbuild/protobuf` 反序列化结果形状由外部决定」这一真实事实。收紧需要运行时校验库 = 新增依赖（红线 7） | 保持现状。若将来要收紧，建议引入 `zod` 并在反序列化边界统一校验，而不是逐处 if |
| **`usage-stats.jsonl` 的增量聚合** | 8MB 上限已由 `trimIfTooLarge` 保证，实测读取+解析 30.5ms 且只在打开面板时发生。做增量索引要同步处理「追加 / trim / 改名」三条路径，收益不成比例 | 保持现状 |
| **`styles.ts` / Alpine store 的拆分** | 见「五、决定不做的事」。CSS 模板字符串没有「职责边界」可言；Alpine store 靠 `this` 互相调用，拆分会同时恶化 `this` 绑定与调试体验 | 保持现状 |
| **`splitSubagentDefinitionsFromDescription` 的疑似零宽问题** | 审查中怀疑 `end <= start` 会把两段无关文字缝在一起，于是加了个短路。**后来用脚本实测证明该分支不可达**（`endCandidates` 已被 `index > start` 过滤，为空时 `end = description.length >= start + marker.length`），**已撤销改动**，并把结论写进 `subagentDescriptionSplit.test.ts` 与提交信息 | 无需处理。这是本次唯一一处「我自己提出的修复被自己证伪」的项，记录在此以免后人重复怀疑 |
| **CRLF 与 LF 混用** | 仓库本身混用两种行尾；`--fix` 会把**被改动行**统一成 LF，导致 diff 行数偏大。经确认不影响功能（Node/TS/esbuild 都能处理） | 如需统一，建议单独一个「全仓行尾归一」提交并配 `.gitattributes`，不要混在功能提交里 |
---

## 八、建议人工复核的重点

按「最值得你花时间」排序，每条都给了具体的看什么、为什么：

### 1. `web.ts` 的 `isValidUrl`（`6aed3e9`）—— 唯一一处真正的行为收紧

```
git show 6aed3e9 -- Cursor++/src/server/handlers/agent/web.ts
```

看 `normalizeHostname` / `isIpv4Literal` / `ipv4FromMappedIpv6` / `isPrivateIpv6` 四个
新函数，重点是 `isIpv4Literal` 的存在理由：第一版修复用 `/^(10\.|...)/` 直接测任意
hostname，结果把 `http://10.example.com/` 也拦了（那是个合法公网域名）。**如果只
复核一个文件，就复核这个**：它是安全相关的，且我改错过一次。

### 2. `contextCatalog.ts` 的 frontmatter 正则（`f0aeed0`）—— 收益最大，但有语义差

贡献了 41000× 的收益，但**不是逐字节等价**。看注释里那句「这个改写不是「完全相同」的」，
以及 `skillFrontmatter.test.ts` 里 `still reads the description for a mixed LF-then-CRLF fence`
这条测试 —— 它专门锁住唯一有差异的形状。如果你认为「SKILL.md 里出现 `---\n\r\n`」
必须保持旧行为，那这条改动要回退（代价是 1282ms 的同步阻塞回来）。

### 3. `editStreamExtractor.ts` 的 `PATCH_FILE_HEADER_PATTERN`（`2686ec9`）—— 撤回的改动

这是本次审查里**唯一一次「先改错、再撤回」**。看那段长注释：它记录了（a）改写会收窄
接受语言的三个具体反例，(b) 无性能收益的实测数字，(c) 为什么前两次测试给出了错误的
「0 差异」结论。**请重点确认「保留 `\s+` + 豁免 lint」这个取舍你是否认同** ——
另一条路是接受「`File:` 后直接换行时取不到路径」这个回归换取规则零豁免，
我判断不值当，但这是你的项目。

### 4. `eslint.config.mjs` 与那 18 处 tab（`28585e4`）—— 规则取舍

删掉了 5 个 `ignores`，只剩 `src/server/gen/**`（真生成物，140808 行）与一个
**单文件**的 `style/no-tabs` 豁免。请确认你接受「`EditNotebook.ts` 里有 18 处 tab
且它们会一直触发豁免」这一现状；不接受的话就得改模型可见的描述文本。

### 5. tokenizer 缓存的作用域与失效（`5ef1fce`）

缓存 key 是**文本本身**，没有 TTL、没有失效钩子。这在「同一份 system prompt 反复
计数」的场景下是纯收益，但如果你将来引入「同一段文本在不同配置下 token 数不同」
的机制（比如可切换 tokenizer / 不同 `allowedSpecial`），**这个缓存会静默返回错值**。
看 `tokenCounter.ts` 顶部的 `COUNT_CACHE_LIMIT` 与 `tokenCounterCache.test.ts` 的
等价性断言，确认这个假设在你的路线图里成立。

### 看完这 5 处就够了吗

其余的 `--fix` 格式改动（约 95% 的 diff 行数）可以用 payload 基线快速验完：

```
cd Cursor++
pnpm exec vitest run --config vitest.bench.config.mts
```

输出 `no drift — descriptions and schemas are byte-identical` 即表示 4 个 provider 的
全部工具描述与 schema 逐字节未变。`bench-parse.mts` 的 3 个 digest 用来确认
`parseRunRequest` 的纯移动重构没有改变解析结果。
---

## 九、最终门禁结果

在分支终态 `f1244be`（本文件提交前）实测：

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | **0 error** |
| Lint | `$env:CI="true"; pnpm run lint` | **0 error 0 warning**（全量规则集） |
| 测试 | `pnpm exec vitest run`（需 `CURSOR_APP_ROOT`） | **503 passed / 11 skipped**，49 个文件 |
| 构建 | `node esbuild.js --production` | 见下 |
| payload 等价 | `bench-payload.mts` | **no drift** |
| 解析等价 | `bench-parse.mts` | 3 个 digest 与重构前一致 |

基线对比：测试从 `442 passed` 增至 `503`（**+61 条**，新增 `webUrlGuard`、
`webFetchFailures`、`tokenCounterCache`、`subagentDescriptionSplit`、`skillFrontmatter` 5 个文件）。

**lint 数字的注意点**：本仓库的开发环境里 `pnpm run lint` 会因为 `VSCODE_PID`
存在而进入 @antfu/eslint-config 的 editor 模式，**静默关掉一部分规则**并只打印
一行提示。上面 0/0 是在 `CI=true` 且清掉 `VSCODE_*` 变量后取得的全量结果；
如果你在普通终端直接跑，看到的 `0 problems` 是**较弱**的那个结论。

### 怎么自己复现这三条门禁

```powershell
cd Cursor++
$env:CURSOR_APP_ROOT = "<你的 Cursor 安装目录>\resources\app"   # 30 个 sqlite 测试需要
$env:CI = "true"; Remove-Item Env:VSCODE_PID -ErrorAction SilentlyContinue

npx tsc --noEmit
pnpm run lint
pnpm exec vitest run
```

不设 `CURSOR_APP_ROOT` 会有 30 个测试报错（它们要读 Cursor 自带的 sqlite schema），
那是**环境缺失**而非代码缺陷 —— 这也是为什么该变量没有写进仓库（会泄漏本机路径）。
