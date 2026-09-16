/** Server 状态行 */
export function Server() {
  return (
    <div x-show="$store.app.state" class="server-row">
      <span
        class="dot"
        x-bind:class="{
          'dot-ok': $store.app.state?.server === 'local' || $store.app.state?.server === 'remote',
          'dot-bad': $store.app.state?.server === 'offline' && $store.app.state?.serverIssue === 'port_occupied',
        }"
      >
      </span>
      <span class="server-status" x-text="$store.app.serverLabel"></span>
      <button
        x-show="$store.app.state?.server === 'local' || $store.app.state?.server === 'offline'"
        class="secondary tiny"
        x-text="$store.app.state?.server === 'local' ? 'Stop Server' : 'Start Server'"
        x-bind:disabled="$store.app.state?.serverIssue === 'port_occupied'"
        x-bind:title="$store.app.state?.serverIssue === 'port_occupied' ? 'Port is occupied by another process' : ''"
        x-on:click="$store.app.post('toggleServer')"
      >
      </button>
    </div>
  )
}
