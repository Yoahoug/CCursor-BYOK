/**
 * 底部操作栏
 *
 * 更新按钮单独占一行：它不是配置入口，而是「把当前这份扩展换成本仓库 Release」
 * 的动作，和上面两个「打开配置文件」的语义不同，混在一行里容易被当成第三份配置。
 * 标签会随过程变化（Checking… / Updating to x.y.z…），唯一数据源是 store 的
 * updatePhase，避免按钮文字与实际状态不一致。
 */
export function Footer() {
  return (
    <div class="footer">
      <div class="footer-row">
        <button class="secondary" x-on:click="$store.app.post('editRoutes')">Edit Routes</button>
        <button class="secondary" x-on:click="$store.app.post('editProvidersJson')">Edit providers.json</button>
      </div>
      <div class="footer-row">
        <button
          class="secondary"
          x-text="$store.app.updateButtonLabel"
          x-bind:disabled="$store.app.updatePhase !== ''"
          title="Check the latest release of this fork on GitHub and install it in place"
          x-on:click="$store.app.checkForUpdates()"
        >
        </button>
      </div>
    </div>
  )
}
