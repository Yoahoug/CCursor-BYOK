import type { ProviderModel } from '../../server/data/defaults'
import { describe, expect, it } from 'vitest'
import { reorderById } from '../../shared/listReorder'

function models(...ids: string[]): ProviderModel[] {
  return ids.map(id => ({ id, apiModel: id, displayName: id, thinking: false }) as ProviderModel)
}

function ids(list: readonly { id: string }[]): string[] {
  return list.map(item => item.id)
}

describe('reorderById', () => {
  it('往前拖时插到目标之前', () => {
    const result = reorderById(models('a', 'b', 'c', 'd'), 'd', 'b', false)
    expect(ids(result)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('往后拖时插到目标之后', () => {
    const result = reorderById(models('a', 'b', 'c', 'd'), 'a', 'c', true)
    expect(ids(result)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('往后拖到紧邻的下一个位置', () => {
    const result = reorderById(models('a', 'b', 'c'), 'a', 'b', true)
    expect(ids(result)).toEqual(['b', 'a', 'c'])
  })

  it('往前拖到紧邻的上一个位置', () => {
    const result = reorderById(models('a', 'b', 'c'), 'c', 'b', false)
    expect(ids(result)).toEqual(['a', 'c', 'b'])
  })

  it('拖到列表首尾之外的边界位置', () => {
    expect(ids(reorderById(models('a', 'b', 'c'), 'c', 'a', false))).toEqual(['c', 'a', 'b'])
    expect(ids(reorderById(models('a', 'b', 'c'), 'a', 'c', true))).toEqual(['b', 'c', 'a'])
  })

  it('拖到自己身上时顺序不变', () => {
    const result = reorderById(models('a', 'b', 'c'), 'b', 'b', true)
    expect(ids(result)).toEqual(['a', 'b', 'c'])
  })

  it('id 不存在时原样返回，不抛错', () => {
    expect(ids(reorderById(models('a', 'b'), 'ghost', 'a', false))).toEqual(['a', 'b'])
    expect(ids(reorderById(models('a', 'b'), 'a', 'ghost', false))).toEqual(['a', 'b'])
  })

  it('不修改传入的数组', () => {
    const original = models('a', 'b', 'c')
    reorderById(original, 'c', 'a', false)
    expect(ids(original)).toEqual(['a', 'b', 'c'])
  })

  it('重排不会丢失或重复元素', () => {
    const original = models('a', 'b', 'c', 'd')
    for (const placeAfter of [false, true]) {
      for (const from of ids(original)) {
        for (const to of ids(original)) {
          const result = reorderById(original, from, to, placeAfter)
          expect([...ids(result)].sort()).toEqual(['a', 'b', 'c', 'd'])
        }
      }
    }
  })
})
