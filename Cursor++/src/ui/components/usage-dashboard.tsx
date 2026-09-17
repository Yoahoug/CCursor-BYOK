/**
 * 用量 / 缓存仪表盘
 *
 * 目标回答一个具体问题：我的中转站有没有真的在做前缀缓存？
 * 所以主打指标是**缓存命中率**（缓存读取 / (缓存读取 + 未命中输入)），
 * 而不是笼统的 token 总量。
 *
 * 指标分两个口径上下排开（今日 / 全部累计），趋势图与「按模型」表用 14 天窗口
 * —— 三者时间尺度不同，块标题上都写明了范围，避免被当成同一段时间比较。
 *
 * 图表用 CSS 高度百分比画堆叠柱，不引图表库 —— 14 根柱子不值得为此加依赖，
 * 而且 SVG/canvas 方案在窄侧边栏里反而更难自适应。
 */

/**
 * 单个口径的指标块（今日 / 全部累计）。
 *
 * 抽成组件而不是把标记写两遍：两个口径要显示的东西完全一样，只有取数口径
 * 和标题不同。写两遍的话，以后改一个指标就得同步改两处，迟早会漂移。
 */
function UsageScopeBlock({ scope }: { scope: 'today' | 'allTime' }) {
  const totals = `$store.app.usageScopeTotals('${scope}')`
  return (
    <section class="usage-scope">
      <div class="usage-scope-head">
        <span class="usage-scope-title" x-text={`$store.app.usageScopeLabel('${scope}')`}></span>
        <span class="usage-scope-range" x-text={`$store.app.usageScopeSubtitle('${scope}')`}></span>
      </div>

      <div class="usage-metrics">
        <div class="usage-metric usage-metric-hero">
          <div class="usage-label">Cache Hit Rate</div>
          <div
            class="usage-value"
            {...{ 'x-bind:class': `'tone-' + $store.app.usageTone(${totals}?.cacheHitRate)` }}
            x-text={`$store.app.formatPercent(${totals}?.cacheHitRate)`}
          >
          </div>
          <div class="usage-sub">
            <span x-text={`$store.app.formatCount(${totals}?.cacheReadTokens)`}></span>
            {' read / '}
            <span x-text={`$store.app.formatCount(${totals}?.nonCachedInputTokens)`}></span>
            {' new'}
          </div>
        </div>

        <div class="usage-metric">
          <div class="usage-label">Prompt</div>
          <div
            class="usage-value"
            x-text={`$store.app.formatCount(${totals}?.promptTokens)`}
            {...{ 'x-bind:title': `$store.app.usagePromptTitle('${scope}')` }}
          >
          </div>
          <div class="usage-sub">read + new</div>
        </div>
        <div class="usage-metric">
          <div class="usage-label">Output</div>
          <div class="usage-value" x-text={`$store.app.formatCount(${totals}?.outputTokens)`}></div>
          <div class="usage-sub">generated</div>
        </div>

        <div class="usage-metric">
          <div class="usage-label">Calls</div>
          <div class="usage-value" x-text={`$store.app.formatCount(${totals}?.calls)`}></div>
        </div>
      </div>
    </section>
  )
}

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
            No completed requests yet. Stats accumulate as you use the extension — one record is
            appended after each turn to
            {' '}
            <code>~/.ccursor/usage-stats.jsonl</code>
            .
          </div>
        </template>

        <template {...{ 'x-if': '!$store.app.usageError && $store.app.usageHasData()' }}>
          <div>
            {/*
              今日在上、累计在下：这两个口径回答的是不同问题 ——
              "今天有没有白花"和"总体上省了多少"，所以并排会让人下意识横向比较，
              而它们的时间尺度根本不同，比了没有意义。上下排开各自成块更清楚。
            */}
            <div class="usage-scopes">
              <UsageScopeBlock scope="today" />
              <UsageScopeBlock scope="allTime" />
            </div>

            {/* ── 每日趋势 ── */}
            <div class="usage-chart-head">
              <span class="usage-label">
                Daily prompt tokens ·
                {' '}
                <span x-text="$store.app.usageRangeShort()"></span>
              </span>
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
              <span class="usage-label">
                By model ·
                {' '}
                <span x-text="$store.app.usageRangeShort()"></span>
              </span>
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
