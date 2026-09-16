import { Banner } from './banner'
import { ConfirmDialog } from './confirm-dialog'
import { Footer } from './footer'
import { Providers } from './providers'
import { WebToolsButton, WebToolsDialog } from './search-section'
import { Server } from './server'
import { styles } from './styles'
import { ToastContainer } from './toast'
import { UsageDashboard } from './usage-dashboard'

/**
 * CSS 必须以 dangerouslySetInnerHTML 注入 —— 不能用 <style>{css}</style>。
 *
 * hono/jsx 会把 style 标签的子节点当普通文本做 HTML 转义：字体名里的双引号
 * 会被写成 &quot;（`"SF Mono"` → `&quot;SF Mono&quot;`），codicon 的 content
 * 转义序列也会被跟着二次转义。转义后的声明不合法，CSS 解析器会静默丢弃，
 * 表现就是某条规则莫名不生效，且不报任何错。
 */
function StyleSheet({ css }: { css: string }) {
  return <style dangerouslySetInnerHTML={{ __html: css }} />
}

function Layout({ webviewJs, codiconUri }: { webviewJs: string, codiconUri?: string }) {
  const codiconCss = codiconUri
    ? `@font-face { font-family: 'codicon'; font-display: block; src: url('${codiconUri}') format('truetype'); }
       .codicon { font-family: 'codicon'; font-size: 14px; line-height: 1; display: inline-block; -webkit-font-smoothing: antialiased; }
       .codicon::before { display: inline-block; }
       .codicon-eye::before { content: "\\ea70"; }
       .codicon-eye-closed::before { content: "\\eae7"; }`
    : ''

  return (
    <html>
      <head>
        <meta charset="UTF-8" />
        <StyleSheet css={codiconCss + styles} />
      </head>
      <body x-data>
        <Banner />

        {/*
          两个子界面：仪表盘（默认）与配置。
          默认落在仪表盘，是因为打开面板最常见的诉求是确认"通不通、省了多少"，
          而不是改配置；需要改配置时切一次即可，改完切回来立刻能看到变化。
        */}
        <div class="tabs" role="tablist">
          <button
            type="button"
            class="tab"
            role="tab"
            x-bind:class="{ 'active': $store.app.activeTab === 'dashboard' }"
            x-bind:aria-selected="$store.app.activeTab === 'dashboard'"
            x-on:click="$store.app.setTab('dashboard')"
          >
            Dashboard
          </button>
          <button
            type="button"
            class="tab"
            role="tab"
            x-bind:class="{ 'active': $store.app.activeTab === 'config' }"
            x-bind:aria-selected="$store.app.activeTab === 'config'"
            x-on:click="$store.app.setTab('config')"
          >
            Config
          </button>
        </div>

        {/* ── 仪表盘 ── */}
        <div x-show="$store.app.activeTab === 'dashboard'">
          <h3>
            <span>Server</span>
            <span
              class="hint"
              {...{ 'x-effect': '$el.textContent = \'v\' + ($store.app.state?.version || \'\')' }}
            >
            </span>
          </h3>
          <Server />
          <UsageDashboard />
        </div>

        {/* ── 配置 ── */}
        <div x-show="$store.app.activeTab === 'config'" x-cloak>
          <h3>
            <span>Providers</span>
            <span class="h3-actions">
              <WebToolsButton />
              <button class="tiny" x-on:click="$store.app.addProvider()">+ Add</button>
            </span>
          </h3>
          <Providers />
        </div>

        <WebToolsDialog />
        <ConfirmDialog />

        <Footer />
        <ToastContainer />

        <script dangerouslySetInnerHTML={{ __html: webviewJs }} />
      </body>
    </html>
  )
}

/** 生成完整 HTML 字符串 (extension host 侧调用) */
export function renderHtml(webviewJs: string, codiconUri?: string): string {
  const html = (<Layout webviewJs={webviewJs} codiconUri={codiconUri} />).toString()
  return `<!DOCTYPE html>${html}`
}
