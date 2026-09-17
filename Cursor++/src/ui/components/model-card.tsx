import { Autocomplete } from './autocomplete'
import { CustomSelect } from './custom-select'

/**
 * 档位选项按协议分化。
 *
 * 这些 label 保持英文原样，因为它们是**直接发给 API 的枚举值**
 * （reasoning_effort / thinkingLevel 的取值），不是界面文案 —— 翻译了用户就
 * 没法拿它和中转站文档对照。
 */
const THINKING_LEVELS_ANTHROPIC = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
]
const THINKING_LEVELS_OPENAI = [
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
]
const THINKING_LEVELS_GEMINI = [
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
]
const QS_LEVELS_ANTHROPIC = THINKING_LEVELS_ANTHROPIC.map(level => level.value)
const QS_LEVELS_OPENAI = THINKING_LEVELS_OPENAI.map(level => level.value)
const QS_LEVELS_GEMINI = THINKING_LEVELS_GEMINI.map(level => level.value)

/**
 * 单个 Model 卡片 — 在 x-for="m in ..." 作用域内使用
 *
 * 文本/数字输入框使用 x-effect + activeElement 守卫:
 *   - 非焦点时: x-effect 同步 store 值到 DOM (外部变更 / 初始化)
 *   - 焦点时: 只由 x-on:input 写 store, 不回写 DOM, 避免光标跳动
 *
 * apiModel 输入不在每次 keystroke 同步 m.id (会导致 x-for key 变化, 触发 DOM
 * 销毁重建, 进而脱焦), 改为 blur 时调用 syncModelId() 一次性同步。
 *
 * 协议相关分支一律读 $store.app.modelProtocolType(p.id, m.id) 而不是 p.type ——
 * 协议只挂在模型上, 读 p.type 会拿到过时的缺省值 (见 effectiveProviderType)。
 */
export function ModelCard() {
  return (
    <div
      class="model-item"
      x-data="{ me: {} }"
      x-effect="me = $store.app.getModelErrors(p.id, m.id)"
      x-bind:class="{
        'model-dragging': $store.app.modelDragId === m.id,
        'model-drop-top': $store.app.modelDropEdge(m.id) === 'top',
        'model-drop-bottom': $store.app.modelDropEdge(m.id) === 'bottom',
      }"
      {...{ 'x-on:dragover.prevent': '$store.app.hoverModelDuringDrag(m.id, $event)' }}
      {...{ 'x-on:drop.prevent': '$store.app.dropModel(p.id, m.id)' }}
    >
      <div class="model-head" x-on:click="$store.app.toggleModelExpand(p.id, m.id)">
        {/* 拖动握把。单独一个手势区而不是让整条头部可拖，否则想展开时手一抖就变成排序。
            stop 掉 click，避免松开鼠标时顺带把卡片折叠了 */}
        <span
          class="model-drag-handle"
          draggable="true"
          title="Drag to reorder — this order is what Cursor's model picker uses"
          {...{ 'x-on:dragstart': '$store.app.beginModelDrag(m.id)' }}
          {...{ 'x-on:dragend': '$store.app.endModelDrag()' }}
          {...{ 'x-on:click.stop': '' }}
        >
        </span>
        <span class="acc-caret" x-text="$store.app.modelExpanded[p.id]?.[m.id] ? '▼' : '▶'"></span>
        <span class="model-title" x-text="m.displayName || m.apiModel || m.id || '(unnamed model)'"></span>
        {/* 测试结果徽标 —— 未测试时不渲染, 保持列表干净; 点击即重测或取消 */}
        <template x-if="$store.app.modelTestSummary(m.id)">
          <button
            type="button"
            class="badge"
            x-bind:class="'badge-' + $store.app.modelTestTone(m.id)"
            x-bind:title="$store.app.modelTestDetail(m.id)"
            {...{ 'x-on:click.stop': '$store.app.modelTest(m.id)?.running ? $store.app.cancelModelTest(m.id) : $store.app.testModel(p.id, m.id)' }}
            x-text="$store.app.modelTestSummary(m.id)"
          >
          </button>
        </template>
        {/* 右对齐的开关, 控制模型是否注册到 Cursor 选择器。
            stop 阻止点击冒泡触发折叠 */}
        <label
          class="model-switch"
          title="Show this model in Cursor's model picker"
          {...{ 'x-on:click.stop': '' }}
        >
          <input
            type="checkbox"
            x-bind:checked="m.defaultOn === true"
            x-on:change="$store.app.updateModelField(p.id, m.id, 'defaultOn', $event.target.checked)"
          />
          <span class="model-switch-track"></span>
          <span class="model-switch-knob"></span>
        </label>
      </div>
      <div class="model-body" x-show="$store.app.modelExpanded[p.id]?.[m.id]" x-cloak>
        {/* 模型名 + 自动补全 */}
        <div class="field autocomplete" {...{ 'x-on:click.outside': '$store.app.acClose()' }}>
          <label>
            {'API Model '}
            <span class="label-note">the real name sent to the endpoint</span>
          </label>
          <div class="ac-input-wrap">
            <input
              type="text"
              x-ref="acInput"
              x-effect="if(document.activeElement !== $el) $el.value = m.apiModel || ''"
              x-on:input="$store.app.updateModelField(p.id, m.id, 'apiModel', $event.target.value); $store.app.searchCatalog(p.id, m.id, $event.target.value)"
              {...{ 'x-on:blur': '$store.app.syncModelId(p.id, m.id)' }}
              {...{ 'x-on:keydown.arrow-down.prevent': '$store.app.acNavigate(1)' }}
              {...{ 'x-on:keydown.arrow-up.prevent': '$store.app.acNavigate(-1)' }}
              {...{ 'x-on:keydown.enter.prevent': '$store.app.acSelect(p.id, m.id)' }}
              {...{ 'x-on:keydown.escape.prevent': '$store.app.acClose()' }}
              autocomplete="off"
              x-bind:class="{'invalid': me?.apiModel}"
            />
            <button
              class="ac-toggle"
              type="button"
              title="Browse the built-in model catalog"
              tabindex={-1}
              {...{ 'x-on:mousedown.prevent': '$store.app.toggleCatalog(p.id, m.id, $refs.acInput)' }}
            >
              <span class="ac-toggle-caret" x-bind:class="{ 'open': $store.app.ac?.pid === p.id && $store.app.ac?.mid === m.id }">&#x25BE;</span>
            </button>
          </div>
          <div class="err" x-show="me?.apiModel" x-text="me?.apiModel"></div>
          <Autocomplete />
        </div>

        {/* 显示名称 —— Cursor 客户端所有 UI 路径都走这一个名字, 不需要另设简称 */}
        <div class="field">
          <label>
            {'Display Name '}
            <span class="req" x-show="me?.displayName">*</span>
          </label>
          <input
            type="text"
            x-effect="if(document.activeElement !== $el) $el.value = m.displayName || ''"
            x-on:input="$store.app.updateModelField(p.id, m.id, 'displayName', $event.target.value)"
            x-bind:class="{'invalid': me?.displayName}"
          />
          <div class="err" x-show="me?.displayName" x-text="me?.displayName"></div>
        </div>

        {/* 协议 —— 每模型单独指定。一个中转站里 gemini / gpt / deepseek / glm
            往往各走各的接口形态, 所以协议挂在模型上才对应真实结构。
            没手动选过时按模型名自动推导, 角标显示 auto。 */}
        <div class="field">
          <label>
            {'Protocol '}
            <span class="label-note" x-show="$store.app.modelProtocolIsAuto(p.id, m.id)">auto</span>
          </label>
          <div class="seg">
            <template x-for="fam in $store.app.modelProtocolOptions()" x-bind:key="fam.value">
              <button
                type="button"
                class="seg-btn"
                x-bind:class="{ 'active': $store.app.modelProtocolSelection(p.id, m.id) === fam.value }"
                x-bind:title="fam.hint"
                x-on:click="$store.app.setModelProtocol(p.id, m.id, fam.value)"
                x-text="fam.label"
              >
              </button>
            </template>
          </div>
          <div class="endpoint">
            <span class="endpoint-label">Final URL</span>
            <code class="endpoint-url" x-text="$store.app.modelRequestUrlPreview(p.id, m.id)"></code>
          </div>
          <template x-if="$store.app.baseUrlShape(p.id, m.id)?.level === 'warn'">
            <div class="notice notice-warn">
              <span x-text="$store.app.baseUrlShape(p.id, m.id).message"></span>
            </div>
          </template>
        </div>

        {/* 连通性测试与协议自动识别。
            测试走的是真实协议路径 (复用 provider 实现), 所以测通了基本就是能用了,
            而不只是"端口开着"。指标含义:
              tok/s        整段耗时内的平均吞吐
              首字         首个正文 token 的延迟 (思考 token 不计入)
              首个响应事件  首个有效事件延迟, 与首字不同时额外展示 */}
        <div class="field">
          <div class="probe">
            <div class="probe-row">
              <button
                type="button"
                class="tiny"
                {...{ 'x-bind:disabled': '$store.app.protocolDetecting[m.id] === true' }}
                x-on:click="$store.app.detectProtocol(p.id, m.id)"
                {...{ 'x-text': '$store.app.protocolDetecting[m.id] ? \'Detecting…\' : \'Auto-detect\'' }}
              >
              </button>
              <button
                type="button"
                class="tiny secondary"
                x-bind:class="{ 'secondary': !$store.app.modelTest(m.id)?.running }"
                x-on:click="$store.app.modelTest(m.id)?.running ? $store.app.cancelModelTest(m.id) : $store.app.testModel(p.id, m.id)"
                {...{ 'x-text': '$store.app.modelTest(m.id)?.running ? \'Cancel\' : \'Test\'' }}
              >
              </button>
            </div>
            <div class="hint">
              Sends a real request per protocol.
            </div>
          </div>

          <template x-if="$store.app.modelTest(m.id)?.result">
            <div class="test-card" x-bind:class="{ 'test-card-bad': $store.app.modelTestTone(m.id) === 'bad', 'test-card-idle': $store.app.modelTestTone(m.id) === 'idle' }">
              <div class="test-card-head">
                <span class="test-card-summary" x-text="$store.app.modelTestSummary(m.id)"></span>
                <button type="button" class="tiny ghost" x-on:click="$store.app.clearModelTest(m.id)">Clear</button>
              </div>

              <template x-if="$store.app.modelTest(m.id).result.status === 'success'">
                <div class="test-metrics" x-text="$store.app.modelTestMetrics(m.id)"></div>
              </template>

              <template x-if="$store.app.modelTest(m.id).result.status === 'error'">
                <div>
                  <div class="test-error-kind" x-text="$store.app.modelTestErrorLabel(m.id)"></div>
                  <div class="hint" x-text="$store.app.modelTestErrorHint(m.id)"></div>
                  <code class="test-error-msg" x-text="$store.app.modelTest(m.id).result.message"></code>
                </div>
              </template>

              {/* 逐个协议的失败原因 —— 全部打不通时, 信息量远比"只有一种能通"大 */}
              <template x-if="$store.app.modelTest(m.id).result.status !== 'success' && $store.app.protocolDetections[m.id]?.attempts?.length">
                <details class="test-raw">
                  <summary>Per-protocol attempts</summary>
                  <pre x-text="$store.app.protocolAttemptsText(m.id)"></pre>
                </details>
              </template>

              <template x-if="$store.app.modelTestOutput(m.id)">
                <details class="test-raw">
                  <summary>Raw response</summary>
                  <pre x-text="$store.app.modelTestOutput(m.id)"></pre>
                </details>
              </template>
            </div>
          </template>
        </div>

        {/* 能力开关 */}
        <div class="caps">
          <label class="check">
            <input type="checkbox" x-bind:checked="m.supportsAgent !== false" x-on:change="$store.app.updateModelField(p.id, m.id, 'supportsAgent', $event.target.checked)" />
            {' Agent'}
          </label>
          <label class="check">
            <input type="checkbox" x-bind:checked="m.supportsImages !== false" x-on:change="$store.app.updateModelField(p.id, m.id, 'supportsImages', $event.target.checked)" />
            {' Images'}
          </label>
          <label class="check">
            <input type="checkbox" x-bind:checked="m.supportsCmdK !== false" x-on:change="$store.app.updateModelField(p.id, m.id, 'supportsCmdK', $event.target.checked)" />
            {' Cmd+K'}
          </label>
          <label class="check" title="Fast mode (OpenAI uses service_tier=priority, Anthropic uses the fast-mode beta)">
            <input type="checkbox" x-bind:checked="m.fastMode === true" x-on:change="$store.app.updateModelField(p.id, m.id, 'fastMode', $event.target.checked || undefined)" />
            {' Fast'}
          </label>
          <label class="check thinking-cell" title="Enable extended thinking">
            <input type="checkbox" x-bind:checked="m.thinking === true" x-on:change="$store.app.updateModelField(p.id, m.id, 'thinking', $event.target.checked)" />
            {' Thinking'}
          </label>
          {/* 思考子控件:
              未开启思考 → 灰色占位
              Anthropic → 档位/预算 互斥切换
              OpenAI    → 仅档位下拉
              Gemini    → 档位/预算 互斥切换 (档位需 2.5+, 预算兼容旧模型) */}
          <template x-if="!m.thinking">
            <div class="check thinking-sub-disabled">
              <span style="opacity:.35;font-size:10px">—</span>
            </div>
          </template>

          {/* Anthropic: 档位 或 预算 */}
          <template x-if="m.thinking && $store.app.modelProtocolType(p.id, m.id) === 'anthropic'">
            <div class="check thinking-mode-group">
              <div class="thinking-mode-tabs">
                <button
                  class="thinking-mode-tab"
                  x-bind:class="{'active': !!m.thinkingLevel && !m.thinkingBudgetTokens}"
                  x-on:click="$store.app.setThinkingMode(p.id, m.id, 'level')"
                  title="Adaptive level (4.5-opus / 4.6+)"
                >
                  Level
                </button>
                <button
                  class="thinking-mode-tab"
                  x-bind:class="{'active': !m.thinkingLevel && !!m.thinkingBudgetTokens}"
                  x-on:click="$store.app.setThinkingMode(p.id, m.id, 'budget')"
                  title="Legacy budget (Claude 4.x)"
                >
                  Budget
                </button>
              </div>
              <div class="thinking-mode-value" x-show="!!m.thinkingLevel">
                <CustomSelect
                  valueExpr="m.thinkingLevel || ''"
                  changeExpr="$store.app.updateModelField(p.id, m.id, 'thinkingLevel', $value || undefined)"
                  options={THINKING_LEVELS_ANTHROPIC}
                  title="Anthropic effort level"
                />
              </div>
              <div class="thinking-mode-value" x-show="!m.thinkingLevel">
                <input
                  type="number"
                  x-effect="if(document.activeElement !== $el) $el.value = m.thinkingBudgetTokens ?? ''"
                  x-on:input="$store.app.updateModelNumber(p.id, m.id, 'thinkingBudgetTokens', $event.target.value)"
                  placeholder="≥ 1024"
                  title="budget_tokens (must be >= 1024 and below max output)"
                  x-bind:class="{'invalid': me?.thinkingBudgetTokens}"
                  style="height:20px;padding:0 4px;font-size:10px;width:80px"
                />
                <div class="err" x-show="me?.thinkingBudgetTokens" x-text="me?.thinkingBudgetTokens" style="font-size:9px"></div>
              </div>
            </div>
          </template>

          {/* OpenAI: 只有档位 */}
          <template x-if="m.thinking && ($store.app.modelProtocolType(p.id, m.id) === 'openai-chat' || $store.app.modelProtocolType(p.id, m.id) === 'openai-responses')">
            <div class="check thinking-level-cell">
              <CustomSelect
                valueExpr="m.thinkingLevel || 'medium'"
                changeExpr="$store.app.updateModelField(p.id, m.id, 'thinkingLevel', $value)"
                options={THINKING_LEVELS_OPENAI}
                title="reasoning_effort level"
              />
            </div>
          </template>

          {/* Gemini: 档位 或 预算。后端优先级 budget > level > 自动 */}
          <template x-if="m.thinking && $store.app.modelProtocolType(p.id, m.id) === 'gemini'">
            <div class="check thinking-mode-group">
              <div class="thinking-mode-tabs">
                <button
                  class="thinking-mode-tab"
                  x-bind:class="{'active': !!m.thinkingLevel && !m.thinkingBudgetTokens}"
                  x-on:click="$store.app.setThinkingMode(p.id, m.id, 'level')"
                  title="thinkingLevel (Gemini 2.5+)"
                >
                  Level
                </button>
                <button
                  class="thinking-mode-tab"
                  x-bind:class="{'active': !m.thinkingLevel && !!m.thinkingBudgetTokens}"
                  x-on:click="$store.app.setThinkingMode(p.id, m.id, 'budget')"
                  title="thinkingBudget (works with older models, precise control)"
                >
                  Budget
                </button>
              </div>
              <div class="thinking-mode-value" x-show="!!m.thinkingLevel">
                <CustomSelect
                  valueExpr="m.thinkingLevel || ''"
                  changeExpr="$store.app.updateModelField(p.id, m.id, 'thinkingLevel', $value || undefined)"
                  options={THINKING_LEVELS_GEMINI}
                  title="Gemini thinkingLevel"
                />
              </div>
              <div class="thinking-mode-value" x-show="!m.thinkingLevel">
                <input
                  type="number"
                  x-effect="if(document.activeElement !== $el) $el.value = m.thinkingBudgetTokens ?? ''"
                  x-on:input="$store.app.updateModelNumber(p.id, m.id, 'thinkingBudgetTokens', $event.target.value)"
                  placeholder="tokens / -1 auto"
                  title="thinkingBudget (-1 = auto, 0 = off)"
                  x-bind:class="{'invalid': me?.thinkingBudgetTokens}"
                  style="height:20px;padding:0 4px;font-size:10px;width:80px"
                />
                <div class="err" x-show="me?.thinkingBudgetTokens" x-text="me?.thinkingBudgetTokens" style="font-size:9px"></div>
              </div>
            </div>
          </template>
        </div>

        {/* 上下文与输出上限 */}
        <div class="field-row">
          <div class="field">
            <label>
              {'Context Limit '}
              <span class="req">*</span>
            </label>
            <input
              type="number"
              x-effect="if(document.activeElement !== $el) $el.value = m.contextTokenLimit ?? ''"
              x-on:input="$store.app.updateModelNumber(p.id, m.id, 'contextTokenLimit', $event.target.value)"
              placeholder="required"
              x-bind:class="{'invalid': me?.contextTokenLimit}"
            />
            <div class="err" x-show="me?.contextTokenLimit" x-text="me?.contextTokenLimit"></div>
          </div>
          <div class="field">
            <label>
              {'Max Output '}
              <span class="req" x-show="m.noMaxTokens !== true">*</span>
            </label>
            <div style="display:flex;align-items:center;gap:6px">
              {/* 仅切换"不发送"标志, 不清空已填的值 —— 发送侧已做守卫,
                  保留原值才能在取消勾选后恢复, 禁用态灰显原值也更直观 */}
              <input
                type="number"
                x-effect="if(document.activeElement !== $el) $el.value = m.maxOutputTokens ?? ''"
                x-on:input="$store.app.updateModelNumber(p.id, m.id, 'maxOutputTokens', $event.target.value)"
                placeholder="required"
                {...{ 'x-bind:placeholder': 'm.noMaxTokens === true ? \'disabled (not sent)\' : \'required\'' }}
                x-bind:disabled="m.noMaxTokens === true"
                title="Max tokens for a single response"
                x-bind:class="{'invalid': me?.maxOutputTokens}"
                style="flex:1"
              />
              <label class="check" style="white-space:nowrap;font-size:10px" title="Do not send this parameter to the endpoint; some gateways reject it">
                <input
                  type="checkbox"
                  x-bind:checked="m.noMaxTokens === true"
                  x-on:change="$store.app.updateModelField(p.id, m.id, 'noMaxTokens', $event.target.checked)"
                />
                {' Omit'}
              </label>
            </div>
            <div class="err" x-show="me?.maxOutputTokens" x-text="me?.maxOutputTokens"></div>
          </div>
        </div>

        {/* 提示气泡 */}
        <div class="field">
          <label>Tooltip (shown on hover in Cursor's model picker, Markdown supported)</label>
          <textarea
            rows={2}
            x-effect="if(document.activeElement !== $el) $el.value = m.tooltipMarkdown || ''"
            x-on:input="$store.app.updateModelField(p.id, m.id, 'tooltipMarkdown', $event.target.value)"
            placeholder="**Model name**<br/>One-line description"
          >
          </textarea>
        </div>

        {/* 快速切换参数（可折叠） */}
        <div class="qs-section" x-data="{ qsOpen: false }">
          <button class="qs-header" x-on:click="qsOpen = !qsOpen" type="button">
            <span class="qs-caret" x-text="qsOpen ? '▼' : '▶'"></span>
            <span>Quick-switch params</span>
            <span class="qs-hint" title="Checked entries appear in the Edit panel of Cursor's model picker and can be toggled at runtime.">?</span>
          </button>
          <div class="qs-body" x-show="qsOpen" x-cloak>

            {/* Anthropic: 思考开关 + 档位 */}
            <template x-if="$store.app.modelProtocolType(p.id, m.id) === 'anthropic'">
              <div class="qs-item" title="Expose the thinking toggle in the Edit panel">
                <div class="qs-row">
                  <span class="qs-label">Thinking</span>
                  <label class="qs-switch">
                    <input type="checkbox" x-bind:checked="m.parameters?.thinking === true" x-on:change="$store.app.setEditParam(p.id, m.id, 'thinking', $event.target.checked || undefined)" />
                    <span class="qs-switch-track"></span>
                    <span class="qs-switch-knob"></span>
                  </label>
                </div>
              </div>
            </template>
            <template x-if="$store.app.modelProtocolType(p.id, m.id) === 'anthropic'">
              <div class="qs-item" title="Expose the level picker in the Edit panel">
                <div class="qs-row">
                  <span class="qs-label">Level</span>
                  <label class="qs-switch">
                    <input type="checkbox" x-bind:checked="Array.isArray(m.parameters?.effort)" x-on:change={`$store.app.setEditParam(p.id, m.id, 'effort', $event.target.checked ? ${JSON.stringify(QS_LEVELS_ANTHROPIC)} : undefined)`} />
                    <span class="qs-switch-track"></span>
                    <span class="qs-switch-knob"></span>
                  </label>
                </div>
                <template x-if="Array.isArray(m.parameters?.effort)">
                  <div class="qs-item-body">
                    <div class="qs-chips">
                      {QS_LEVELS_ANTHROPIC.map(level => (
                        <label class="qs-chip" key={level}>
                          <input type="checkbox" x-bind:checked={`m.parameters?.effort?.includes('${level}')`} x-on:change={`$store.app.toggleEditParamArrayItem(p.id, m.id, 'effort', '${level}', $event.target.checked)`} />
                          <span>{level}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </template>
              </div>
            </template>

            {/* Gemini: 思考开关 + 档位（另一套枚举） */}
            <template x-if="$store.app.modelProtocolType(p.id, m.id) === 'gemini'">
              <div class="qs-item" title="Expose the thinking toggle in the Edit panel">
                <div class="qs-row">
                  <span class="qs-label">Thinking</span>
                  <label class="qs-switch">
                    <input type="checkbox" x-bind:checked="m.parameters?.thinking === true" x-on:change="$store.app.setEditParam(p.id, m.id, 'thinking', $event.target.checked || undefined)" />
                    <span class="qs-switch-track"></span>
                    <span class="qs-switch-knob"></span>
                  </label>
                </div>
              </div>
            </template>
            <template x-if="$store.app.modelProtocolType(p.id, m.id) === 'gemini'">
              <div class="qs-item" title="Expose the level picker in the Edit panel">
                <div class="qs-row">
                  <span class="qs-label">Level</span>
                  <label class="qs-switch">
                    <input type="checkbox" x-bind:checked="Array.isArray(m.parameters?.effort)" x-on:change={`$store.app.setEditParam(p.id, m.id, 'effort', $event.target.checked ? ${JSON.stringify(QS_LEVELS_GEMINI)} : undefined)`} />
                    <span class="qs-switch-track"></span>
                    <span class="qs-switch-knob"></span>
                  </label>
                </div>
                <template x-if="Array.isArray(m.parameters?.effort)">
                  <div class="qs-item-body">
                    <div class="qs-chips">
                      {QS_LEVELS_GEMINI.map(level => (
                        <label class="qs-chip" key={level}>
                          <input type="checkbox" x-bind:checked={`m.parameters?.effort?.includes('${level}')`} x-on:change={`$store.app.toggleEditParamArrayItem(p.id, m.id, 'effort', '${level}', $event.target.checked)`} />
                          <span>{level}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </template>
              </div>
            </template>

            {/* OpenAI: 推理档位 */}
            <template x-if="$store.app.modelProtocolType(p.id, m.id) === 'openai-chat' || $store.app.modelProtocolType(p.id, m.id) === 'openai-responses'">
              <div class="qs-item" title="Expose the reasoning level picker in the Edit panel (None = off)">
                <div class="qs-row">
                  <span class="qs-label">Reasoning level</span>
                  <label class="qs-switch">
                    <input type="checkbox" x-bind:checked="Array.isArray(m.parameters?.reasoning)" x-on:change={`$store.app.setEditParam(p.id, m.id, 'reasoning', $event.target.checked ? ${JSON.stringify(QS_LEVELS_OPENAI)} : undefined)`} />
                    <span class="qs-switch-track"></span>
                    <span class="qs-switch-knob"></span>
                  </label>
                </div>
                <template x-if="Array.isArray(m.parameters?.reasoning)">
                  <div class="qs-item-body">
                    <div class="qs-chips">
                      {QS_LEVELS_OPENAI.map(level => (
                        <label class="qs-chip" key={level}>
                          <input type="checkbox" x-bind:checked={`m.parameters?.reasoning?.includes('${level}')`} x-on:change={`$store.app.toggleEditParamArrayItem(p.id, m.id, 'reasoning', '${level}', $event.target.checked)`} />
                          <span>{level}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </template>
              </div>
            </template>

            {/* 上下文档位 */}
            <div class="qs-item" title="Expose the context window picker in the Edit panel">
              <div class="qs-row">
                <span class="qs-label">Context levels</span>
                <label class="qs-switch">
                  <input type="checkbox" x-bind:checked="Array.isArray(m.parameters?.context)" x-on:change="$store.app.setEditParam(p.id, m.id, 'context', $event.target.checked ? [m.contextTokenLimit || 200000] : undefined)" />
                  <span class="qs-switch-track"></span>
                  <span class="qs-switch-knob"></span>
                </label>
              </div>
              <template x-if="Array.isArray(m.parameters?.context)">
                <div class="qs-item-body">
                  <div class="qs-tags">
                    <template x-for="(cv, ci) in (m.parameters?.context || [])">
                      <span class="qs-tag">
                        <span x-text="cv >= 1000000 ? (cv/1000000)+'M' : Math.round(cv/1000)+'K'"></span>
                        <button class="qs-tag-x" x-on:click="$store.app.removeEditParamArrayIndex(p.id, m.id, 'context', ci)">&times;</button>
                      </span>
                    </template>
                    <input
                      type="number"
                      class="qs-tag-input"
                      placeholder="+ tokens"
                      {...{ 'x-on:keydown.enter.prevent': '$store.app.addEditParamContextValue(p.id, m.id, parseInt($event.target.value)); $event.target.value = ""' }}
                    />
                  </div>
                </div>
              </template>
            </div>

            {/* Fast 开关 */}
            <div class="qs-item" title="Expose the Fast mode toggle in the Edit panel">
              <div class="qs-row">
                <span class="qs-label">Fast toggle</span>
                <label class="qs-switch">
                  <input type="checkbox" x-bind:checked="m.parameters?.fast === true" x-on:change="$store.app.setEditParam(p.id, m.id, 'fast', $event.target.checked || undefined)" />
                  <span class="qs-switch-track"></span>
                  <span class="qs-switch-knob"></span>
                </label>
              </div>
            </div>

          </div>
        </div>

        <div class="actions-bar">
          <button class="danger tiny" {...{ 'x-on:click': '$store.app.requestRemoveModel(p.id, m.id)' }}>Delete Model</button>
        </div>
      </div>
    </div>
  )
}
