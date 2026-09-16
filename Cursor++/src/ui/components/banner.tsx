/** BYOK 模式横幅 */
export function Banner() {
  return (
    <div x-show="$store.app.state" class="byok-banner">
      <div class="byok-label">
        <span class="byok-title" x-text="$store.app.state?.byokMode ? 'BYOK Mode: ON' : 'BYOK Mode: OFF'"></span>
        <span
          class="byok-hint"
          x-text="$store.app.state?.byokMode ? 'Using your own providers from providers.json' : 'Passing through to official Cursor backend'"
        >
        </span>
      </div>
      <div class="banner-actions">
        <button
          x-bind:class="$store.app.state?.byokMode ? 'on' : 'off'"
          x-text="$store.app.state?.byokMode ? 'Switch to Official' : 'Enable BYOK'"
          x-on:click="$store.app.post('toggleByok')"
        >
        </button>
      </div>
    </div>
  )
}
