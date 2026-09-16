import { ProviderAccordion } from './provider-accordion'

/** Provider 列表容器 */
export function Providers() {
  return (
    <div>
      {/*
        门禁式空状态 —— 不给一个"空列表 + 按钮", 而是说清这一步在做什么、
        以及下一步该点哪里。协议是这里最容易卡住的一步，所以空状态里就点出来。
      */}
      <template x-if="$store.app.providers.length === 0">
        <div class="gate">
          <div class="gate-title">No providers yet</div>
          <div class="gate-text">
            Add a relay or an official endpoint for Cursor to use. You do not need to
            figure out the protocol yourself — fill in the base URL, key and model name,
            then click "Auto-detect". The plugin probes with real requests and shows the
            full final request URL below.
          </div>
          <div class="gate-actions">
            <button x-on:click="$store.app.addProvider()">+ Add Provider</button>
            <button class="secondary" x-on:click="$store.app.post('editProvidersJson')">Edit providers.json</button>
          </div>
        </div>
      </template>
      <template x-for="(p, pIdx) in $store.app.providers" x-bind:key="p.id">
        <ProviderAccordion />
      </template>
    </div>
  )
}
