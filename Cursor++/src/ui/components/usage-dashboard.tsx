/**
 * 用量 / 缓存仪表盘
 *
 * 目标回答一个具体问题：我的中转站有没有真的在做前缀缓存？
 * 所以主打指标是**缓存命中率**（缓存读取 / (缓存读取 + 未命中输入)），
 * 而不是笼统的 token 总量。
 *
 * 图表用 CSS 高度百分比画堆叠柱，不引图表库 —— 14 根柱子不值得为此加依赖，
 * 而且 SVG/canvas 方案在窄侧边栏里反而更难自适应。
 */
export function UsageDashboard() {
  return (
    <section class="usage">
      <h3>
        <span>Usage & Cache</span>
        <span class="h3-actions">
          <button
            type="button"
            class="tiny secondary"
            {...{ 'x-bind:disabled': '$store.app.usageLoading' }}
            x-on:click="$store.app.loadUsageStats()"
            x-text="$store.app.usageLoading ? 'Loading…' : '↻ Refresh'"
          >
          </button>
        </span>
      </h3>

      <div class="usage-body">
        <template {...{ 'x-if': '$store.app.usageError' }}>
          <div class="notice notice-bad">
            <span class="notice-text" x-text="$store.app.usageError"></span>
          </div>
        </template>

        <template {...{ 'x-if': '!$store.app.usageError && !$store.app.usageHasData()' }}>
          <div class="usage-empty">
            No completed requests in the last
            {' '}
            <span x-text="$store.app.usageStats?.windowDays || 14"></span>
            {' '}
            days. Stats accumulate as you use the extension — one record is appended after each turn to
            {' '}
            <code>~/.ccursor/usage-stats.jsonl</code>
            .
          </div>
        </template>

        <template {...{ 'x-if': '!$store.app.usageError && $store.app.usageHasData()' }}>
          <div>
            {/* ── 指标 ── */}
            <div class="usage-metrics">
              <div class="usage-metric usage-metric-hero">
                <div class="usage-label">Cache Hit Rate</div>
                <div
                  class="usage-value"
                  {...{ 'x-bind:class': '\'tone-\' + $store.app.usageTone($store.app.usageTotals()?.cacheHitRate)' }}
                  x-text="$store.app.formatPercent($store.app.usageTotals()?.cacheHitRate)"
                >
                </div>
                <div class="usage-sub">
                  <span x-text="$store.app.formatCount($store.app.usageTotals()?.cacheReadTokens)"></span>
                  {' read / '}
                  <span x-text="$store.app.formatCount($store.app.usageTotals()?.nonCachedInputTokens)"></span>
                  {' new'}
                </div>
              </div>

              <div class="usage-metric">
                <div class="usage-label">
                  Cache Write
                  {/* 推算值必须显式标注，否则会被当成上游实测数字读 */}
                  <span class="usage-est" x-show="$store.app.usageCacheWriteEstimated()">est.</span>
                </div>
                <div
                  class="usage-value"
                  x-text="$store.app.formatCount($store.app.usageCacheWriteValue())"
                  {...{ 'x-bind:title': '$store.app.usageCacheWriteTitle()' }}
                >
                </div>
              </div>
              <div class="usage-metric">
                <div class="usage-label">Output</div>
                <div class="usage-value" x-text="$store.app.formatCount($store.app.usageTotals()?.outputTokens)"></div>
                <div class="usage-sub">tokens generated</div>
              </div>

              <div class="usage-metric">
                <div class="usage-label">Calls</div>
                <div class="usage-value" x-text="$store.app.formatCount($store.app.usageTotals()?.calls)"></div>
                <div class="usage-sub">
                  <span x-text="$store.app.formatCount($store.app.usageTotals()?.promptTokens)"></span>
                  {' prompt'}
                </div>
              </div>
            </div>

            {/* ── 每日趋势 ── */}
            <div class="usage-chart-head">
              <span class="usage-label">Daily prompt tokens</span>
              <span class="usage-legend">
                <span class="usage-swatch usage-swatch-cached"></span>
                cached
                <span class="usage-swatch usage-swatch-new"></span>
                new
              </span>
            </div>
            <div class="usage-chart" x-on:mouseleave="$store.app.clearUsageHover()">
              <template {...{ 'x-for': '(day, di) in $store.app.usageDays()', 'x-bind:key': 'day.date' }}>
                <div
                  class="usage-slot"
                  {...{ 'x-on:mouseenter': '$store.app.setUsageHover(day, di, $store.app.usageDays().length)' }}
                >
                  <div
                    class="usage-col"
                    {...{ 'x-bind:style': '\'height:\' + $store.app.usageColumnHeight(day) + \'%\'' }}
                  >
                    <div
                      class="usage-col-cached"
                      {...{ 'x-bind:style': '\'height:\' + $store.app.usageCachedShare(day) + \'%\'' }}
                    >
                    </div>
                  </div>
                </div>
              </template>

              {/*
                悬浮详情常驻 DOM，靠 is-open 切 opacity/transform —— 用 x-show 的话
                display:none → block 之间不会触发 CSS 过渡，就没有动画了。
              */}
              <div
                class="usage-tip"
                x-bind:class="{ 'is-open': $store.app.usageHover !== null }"
                {...{ 'x-bind:style': '$store.app.usageTipStyle()' }}
              >
                <div class="usage-tip-date" x-text="$store.app.usageHover?.day?.date"></div>
                <template x-for="row in $store.app.usageHoverRows()" x-bind:key="row.label">
                  <div class="usage-tip-row">
                    <span class="usage-tip-label" x-text="row.label"></span>
                    <span class="usage-tip-value" x-text="row.value"></span>
                  </div>
                </template>
              </div>
            </div>
            <div class="usage-axis" x-text="$store.app.usageRangeLabel()"></div>

            {/* ── 按模型 ── */}
            <div class="usage-table-head">
              <span class="usage-label">By model</span>
            </div>
            <div class="usage-table">
              <template {...{ 'x-for': 'row in $store.app.usageModelRows()', 'x-bind:key': 'row.provider + row.model' }}>
                <div class="usage-row">
                  <div class="usage-row-name">
                    <span class="usage-row-model" x-text="row.model"></span>
                    <span class="usage-row-provider" x-text="row.provider"></span>
                  </div>
                  <div class="usage-row-rate" {...{ 'x-bind:class': '\'tone-\' + $store.app.usageTone(row.cacheHitRate)' }}>
                    <span x-text="$store.app.formatPercent(row.cacheHitRate)"></span>
                  </div>
                  <div class="usage-row-calls" x-text="$store.app.formatCount(row.calls) + ' calls'"></div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </section>
  )
}
