/**
 * 列表按 id 重排
 *
 * 供模型拖动排序使用。抽成纯函数而不是直接在 store 里改数组，是因为这段逻辑
 * 有一个很容易写错的点：**移除被拖元素后，目标元素的下标会左移**。
 * 复用移除前的下标会把元素插到错误的位置，而且只在"往后拖"时才出错，
 * 手测很容易漏掉。放在这里可以单测钉住。
 */

/** 重排结果始终是新数组；调用方据此触发响应式更新 */
export function reorderById<T extends { id: string }>(
  items: readonly T[],
  draggedId: string,
  targetId: string,
  placeAfter: boolean,
): T[] {
  const next = items.slice()

  // 拖到自己身上是无操作。必须先判，否则下面的下标重算会把元素挪到邻近位置，
  // 用户会看到"点一下没动，但顺序变了"这种莫名其妙的结果。
  if (draggedId === targetId)
    return next

  const fromIndex = next.findIndex(item => item.id === draggedId)
  if (fromIndex === -1)
    return next

  if (next.findIndex(item => item.id === targetId) === -1)
    return next

  const [dragged] = next.splice(fromIndex, 1)
  if (!dragged)
    return next

  // 重新查找目标下标：上面的 splice 已经让后续元素整体左移了一位
  const anchorIndex = next.findIndex(item => item.id === targetId)
  next.splice(placeAfter ? anchorIndex + 1 : anchorIndex, 0, dragged)

  return next
}
