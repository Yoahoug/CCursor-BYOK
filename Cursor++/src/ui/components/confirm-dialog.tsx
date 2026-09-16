/**
 * 二次确认弹窗
 *
 * 删除中转站会立刻写 providers.json 且面板无法撤销，误点代价是重配整条链路。
 * 弹窗只用 store 上的描述符渲染，动作还原逻辑在 confirmAction() 里。
 */
export function ConfirmDialog() {
  return (
    <template {...{ 'x-if': '$store.app.confirmDialog' }}>
      <div
        class="modal-backdrop"
        role="presentation"
        {...{ 'x-on:click.self': '$store.app.cancelConfirm()' }}
        {...{ 'x-on:keydown.escape.window': '$store.app.cancelConfirm()' }}
      >
        <div
          class="modal-dialog confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          {...{ 'x-effect': '$store.app.confirmDialog && $refs.confirmAction && $refs.confirmAction.focus()' }}
        >
          <div class="modal-header">
            <span class="modal-title" x-text="$store.app.confirmDialog?.title"></span>
          </div>
          <div class="modal-body">
            <p class="confirm-message" x-text="$store.app.confirmDialog?.message"></p>
            <template {...{ 'x-if': '$store.app.confirmDialog?.warning' }}>
              <p class="confirm-warning" x-text="$store.app.confirmDialog?.warning"></p>
            </template>
            <div class="confirm-actions">
              <button
                type="button"
                class="secondary"
                {...{ 'x-on:click': '$store.app.cancelConfirm()' }}
              >
                Cancel
              </button>
              <button
                type="button"
                class="danger-solid"
                x-ref="confirmAction"
                x-text="$store.app.confirmDialog?.confirmLabel || 'Delete'"
                {...{ 'x-on:click': '$store.app.confirmAction()' }}
              >
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  )
}
