/** Autocomplete 下拉浮层 — 嵌套在 model-card 的 API Model 字段内 */
export function Autocomplete() {
  return (
    <div
      class="autocomplete-list"
      x-show="$store.app.ac && $store.app.ac.pid === p.id && $store.app.ac.mid === m.id"
      x-cloak
    >
      {/* 结果未到达时显示 loading */}
      <div class="ac-loading" x-show="!$store.app.ac?.results?.length">
        <span class="ac-spinner"></span>
      </div>
      <template x-for="(r, i) in ($store.app.ac?.results || [])" x-bind:key="r.id + '-' + i">
        <div
          class="autocomplete-item"
          x-bind:class="{ 'selected': i === $store.app.ac?.selected }"
          {...{ 'x-on:mousedown.prevent': '$store.app.applyCatalogEntry(p.id, m.id, r)' }}
        >
          <div class="ac-name">
            <span x-text="r.name"></span>
            <span style="opacity:.55;font-weight:normal"> · </span>
            <span style="opacity:.55;font-weight:normal" x-text="r.providerName"></span>
          </div>
          <div class="ac-id" x-text="r.id"></div>
          <div
            class="ac-meta"
            x-text="'ctx ' + $store.app.fmtCtx(r.contextLimit)
              + (r.reasoning ? ' · thinking' : '')
              + (r.toolCall ? ' · tools' : '')
              + (r.hasImages ? ' · images' : '')"
          >
          </div>
        </div>
      </template>
    </div>
  )
}
