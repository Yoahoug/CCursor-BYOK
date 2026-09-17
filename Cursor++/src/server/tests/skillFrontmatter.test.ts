import { describe, expect, it } from 'vitest'
import { categorizeCursorRules, normalizeAgentSkill } from '../handlers/agent/contextCatalog'

/**
 * 锁定 FRONTMATTER_PATTERN 的语义边界。
 *
 * 这条正则从 `/^---\s*\n(...)/` 改成 `/^---[^\S\n]*\n(...)/` 是为了消灭
 * super-linear backtracking（30KB 损坏输入 254ms → 0.03ms）。改写不是
 * 逐字节等价的：`\s*` 能吃掉换行而 `[^\S\n]*` 不能，所以前缀后面跟着空行时，
 * 捕获组会多带几个 `\n`。下面用两个**真实消费点**的可观察行为把这个差异钉住，
 * 避免将来有人以为可以随手再改。
 *
 * 注意前缀里的换行必须是单个 `\n`，不能是 `\n+`：写成 `\n+` 时它会与后面的
 * `([\s\S]*?)` 争抢换行，二次回溯会原样保留（详见 contextCatalog 的注释）。
 */

function skillFile(content: string, fullPath = '/workspace/.cursor/skills/demo/SKILL.md') {
  return { fullPath, content, contentIsString: true }
}

function descriptionOfSkill(content: string): string {
  const categorized = categorizeCursorRules({ rules: [skillFile(content)] })
  const skill = categorized.skills[0]
  return skill?.description ?? ''
}

describe('skill frontmatter 描述提取', () => {
  it('reads the description from a plain frontmatter block', () => {
    const content = '---\ndescription: Does a thing\n---\n\n# Body\n'
    expect(descriptionOfSkill(content)).toBe('Does a thing')
  })

  it('reads the description when frontmatter is preceded by blank lines after the fence', () => {
    const content = '---\n\n\n\ndescription: Does a thing\n---\n'
    expect(descriptionOfSkill(content)).toBe('Does a thing')
  })

  it('reads the description when the opening fence has trailing spaces', () => {
    expect(descriptionOfSkill('---   \ndescription: Spaced\n---\n')).toBe('Spaced')
  })

  it('reads the description when the document uses CRLF fences', () => {
    expect(descriptionOfSkill('---\r\ndescription: Crlf\r\n---\r\n')).toBe('Crlf')
  })

  it('still reads the description for a mixed LF-then-CRLF fence', () => {
    // 这是新旧写法捕获组唯一有差异的形状：旧写法把 "\r\n" 留进正文，
    // 新写法并进前缀。两者都仍能从后续行里按 /^description:/m 取到值。
    expect(descriptionOfSkill('---\n\r\ndescription: Mixed\n---\n')).toBe('Mixed')
  })

  it('falls back to the trimmed body when frontmatter has no description key', () => {
    const content = '---\nname: demo\n---\n\nFallback body text\n'
    expect(descriptionOfSkill(content)).toBe(content.trim().slice(0, 120))
  })

  it('falls back to the trimmed body when there is no frontmatter at all', () => {
    const content = 'No frontmatter here at all\n'
    expect(descriptionOfSkill(content)).toBe(content.trim().slice(0, 120))
  })

  it('truncates the fallback body to 120 characters', () => {
    const content = 'x'.repeat(400)
    expect(descriptionOfSkill(content)).toHaveLength(120)
  })

  it('ignores a description key that is not in the frontmatter', () => {
    const content = '# Heading\n\ndescription: Not frontmatter\n'
    expect(descriptionOfSkill(content)).toBe(content.trim().slice(0, 120))
  })
})

describe('disable-model-invocation frontmatter 标记', () => {
  // 这是 FRONTMATTER_PATTERN 的第二个消费点：带该标记的 skill 不进目录。
  // 上面那 346 组「捕获组差一个 \r\n」的输入，在这里必须读出一致的布尔值。
  function skillCount(content: string): number {
    return categorizeCursorRules({ rules: [skillFile(content)] }).skills.length
  }

  it('excludes a skill that disables model invocation', () => {
    const content = '---\ndescription: Refs only\ndisable-model-invocation: true\n---\n'
    expect(skillCount(content)).toBe(0)
  })

  it('keeps a skill whose flag is false or absent', () => {
    expect(skillCount('---\ndescription: Keep me\ndisable-model-invocation: false\n---\n')).toBe(1)
    expect(skillCount('---\ndescription: Keep me\n---\n')).toBe(1)
  })

  it('excludes the skill when the flag precedes the description', () => {
    const content = '---\ndisable-model-invocation: true\ndescription: Flagged\n---\n'
    expect(skillCount(content)).toBe(0)
  })

  it('excludes the skill across the fence shapes where capture groups differ', () => {
    // 混合 LF/CRLF 前缀在旧写法下捕获组会多带 "\r\n"，但按行匹配的标记判定不变。
    expect(skillCount('---\n\r\ndisable-model-invocation: true\ndescription: MixedFlag\n---\n')).toBe(0)
    expect(skillCount('---\n\r\ndescription: MixedFlag\n---\n')).toBe(1)
    expect(skillCount('---\r\ndisable-model-invocation: true\ndescription: CrlfFlag\n---\r\n')).toBe(0)
    expect(skillCount('---   \ndisable-model-invocation: true\ndescription: SpacedFlag\n---\n')).toBe(0)
  })

  it('keeps the description available for skills that remain in the catalog', () => {
    const content = '---\ndescription: Kept skill\n---\n'
    const skill = categorizeCursorRules({ rules: [skillFile(content)] }).skills[0]
    expect(normalizeAgentSkill(skillFile(content)).disableModelInvocation).toBe(false)
    expect(skill.description).toBe('Kept skill')
  })
})

describe('frontmatter 提取的健壮性', () => {
  it('does not hang on a damaged frontmatter with no closing fence', () => {
    // 旧写法在这类输入上指数劣化（192KB 约 1282ms）。
    // 这里断言的是「能在合理时间内返回」，不做精确计时断言以免 CI 抖动。
    const damaged = `---${'  \n'.repeat(60_000)}`
    const startedAt = performance.now()
    descriptionOfSkill(damaged)
    const elapsedMs = performance.now() - startedAt
    expect(elapsedMs).toBeLessThan(1000)
  })

  it('does not hang on a damaged frontmatter made of plain newlines', () => {
    // 这是上一版修复漏掉的形状：前缀写成 `\n+` 时，`\n+` 与后面的
    // `([\s\S]*?)` 仍会争抢同一批换行，二次回溯原样保留。必须与上面那条
    // 「空格 + 换行」的用例成对存在 —— 单测「空格 + 换行」无法发现这个洞。
    const damaged = `---${'\n'.repeat(120_000)}`
    const startedAt = performance.now()
    descriptionOfSkill(damaged)
    const elapsedMs = performance.now() - startedAt
    expect(elapsedMs).toBeLessThan(1000)
  })

  it('does not hang on a damaged frontmatter of plain newlines with a trailing body', () => {
    const damaged = `---${'\n'.repeat(120_000)}body text`
    const startedAt = performance.now()
    expect(descriptionOfSkill(damaged)).toBe(damaged.trim().slice(0, 120))
    expect(performance.now() - startedAt).toBeLessThan(1000)
  })

  it('still reads a description that appears after blank lines inside the fence', () => {
    // 锁定 `\n+` → `\n` 这一步的捕获组语义变化：正文多带几个换行，
    // 但两个消费点按行匹配，读出的值必须不变。
    expect(descriptionOfSkill('---\n\n\n\ndescription: After blanks\n---\n')).toBe('After blanks')
    expect(descriptionOfSkill('---\r\n\r\ndescription: After CRLF blanks\r\n---\r\n')).toBe('After CRLF blanks')
  })

  it('handles a very long but valid description without slowing down', () => {
    const content = `---\ndescription: ${'x'.repeat(200_000)}\n---\n`
    const startedAt = performance.now()
    const description = descriptionOfSkill(content)
    const elapsedMs = performance.now() - startedAt
    expect(description).toHaveLength(200_000)
    expect(elapsedMs).toBeLessThan(1000)
  })

  it('keeps a single-line description intact', () => {
    expect(descriptionOfSkill('---\ndescription: One line\n---\n')).toBe('One line')
  })

  it('treats a fenced block with no content as having no description', () => {
    const content = '---\n\n---\n'
    expect(descriptionOfSkill(content)).toBe(content.trim().slice(0, 120))
  })
})
