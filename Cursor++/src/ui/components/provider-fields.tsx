import { CustomSelect } from './custom-select'

const AUTH_KINDS = [
  { value: 'apiKey', label: 'API Key' },
  { value: 'token', label: 'Bearer Token' },
]

/**
 * Provider 表单字段 — 在 provider accordion body 内, x-for p 作用域
 *
 * 这里**没有协议选择器**：协议挂在模型上（见 ProviderModel.type）。
 * 一个中转站（一个地址、一个 Key）通常同时挂 gemini / gpt / deepseek / glm，
 * 各家走各的接口形态 —— 中转站自己就分流了，用户无法也不需要判断"这个中转站
 * 属于哪一类协议"。所以这一层只保留中转站真正共有的东西：名字、地址、鉴权、
 * 代理、自定义头。协议在模型卡片里选，没选时按模型名自动推导
 * （见 src/shared/providerProtocol.ts 的 defaultProtocolForModel）。
 */
export function ProviderFields() {
  return (
    <>
      <div class="field">
        <label>Name</label>
        <input
          type="text"
          placeholder="My Provider"
          x-effect="if(document.activeElement !== $el) $el.value = $store.app.getDraft(p.id).name || ''"
          x-on:input="$store.app.updateField(p.id, 'name', $event.target.value)"
          x-bind:class="{ 'invalid': $store.app.validate(p.id).errors.name }"
        />
        <div class="err" x-show="$store.app.validate(p.id).errors.name" x-text="$store.app.validate(p.id).errors.name"></div>
      </div>

      {/*
        鉴权方式只有 Anthropic 有两种形态（x-api-key 与 Authorization: Bearer）；
        OpenAI / Gemini 都只有 apiKey 一种。所以这个字段在中转站下挂的模型里
        只要有一个走 Anthropic 就有意义 —— 而"是否有"由模型决定，不是中转站。
      */}
      <div class="field" x-show="$store.app.providerUsesAnthropic(p.id)" x-cloak>
        <label>Auth Kind</label>
        <CustomSelect
          valueExpr="$store.app.getDraft(p.id).auth?.kind"
          changeExpr="$store.app.updateField(p.id, 'auth.kind', $value)"
          options={AUTH_KINDS}
        />
      </div>

      <div class="field">
        <label>
          {'Address '}
          <span class="label-note">host and optional path prefix</span>
        </label>
        <input
          type="text"
          placeholder="http://10.66.66.66:8317"
          x-effect="if(document.activeElement !== $el) $el.value = $store.app.getDraft(p.id).baseUrl || ''"
          x-on:input="$store.app.updateField(p.id, 'baseUrl', $event.target.value)"
          x-bind:class="{ 'invalid': $store.app.validate(p.id).errors.baseUrl }"
        />
        <div class="err" x-show="$store.app.validate(p.id).errors.baseUrl" x-text="$store.app.validate(p.id).errors.baseUrl"></div>
      </div>

      <div class="field" x-data="{ showKey: false }">
        <label>Auth Value</label>
        <div class="input-reveal">
          <input
            x-bind:type="showKey ? 'text' : 'password'"
            placeholder="sk-..."
            x-effect="if(document.activeElement !== $el) $el.value = $store.app.getDraft(p.id).auth?.value || ''"
            x-on:input="$store.app.updateField(p.id, 'auth.value', $event.target.value)"
            x-bind:class="{ 'invalid': $store.app.validate(p.id).errors.authValue }"
          />
          <button
            type="button"
            class="reveal-btn"
            x-on:click="showKey = !showKey"
            title="Toggle visibility"
          >
            <span x-bind:class="showKey ? 'codicon codicon-eye-closed' : 'codicon codicon-eye'"></span>
          </button>
        </div>
        <div class="err" x-show="$store.app.validate(p.id).errors.authValue" x-text="$store.app.validate(p.id).errors.authValue"></div>
      </div>

      {/*
        Proxy 只对 Anthropic / OpenAI 生效 —— Gemini SDK（含最新 2.7.0）的
        GoogleGenAIOptions / HttpOptions 没有 fetch/dispatcher 注入点，无法像
        另外两家那样传 createProxiedFetch。所以只有在中转站下存在非 Gemini 模型
        时才显示。见 ProviderEntry.proxyUrl 的注释。
      */}
      <div class="field" x-show="$store.app.providerUsesProxy(p.id)" x-cloak>
        <label>
          {'Proxy URL '}
          <span class="label-note">optional</span>
        </label>
        <input
          type="text"
          placeholder="http://127.0.0.1:8080"
          x-effect="if(document.activeElement !== $el) $el.value = $store.app.getDraft(p.id).proxyUrl || ''"
          x-on:input="$store.app.updateField(p.id, 'proxyUrl', $event.target.value)"
        />
      </div>

      <div class="field">
        <label>
          {'Custom Headers '}
          <span class="label-note">optional, JSON</span>
        </label>
        <textarea
          rows={2}
          placeholder={'{"anthropic-beta": "interleaved-thinking-2025-05-14"}'}
          {...{ 'x-effect': 'if(document.activeElement !== $el) $el.value = $store.app.formatHeaders(p.id)' }}
          {...{ 'x-on:input': '$store.app.updateHeaders(p.id, $event.target.value)' }}
          {...{ 'x-bind:class': '{ \'invalid\': $store.app.headersInvalid[p.id] }' }}
        >
        </textarea>
        <div class="err" {...{ 'x-show': '$store.app.headersInvalid[p.id]' }}>Invalid JSON</div>
      </div>
    </>
  )
}
