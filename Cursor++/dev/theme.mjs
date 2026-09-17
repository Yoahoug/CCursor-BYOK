/**
 * 从 Cursor 自带的主题文件生成 `--vscode-*` CSS 变量（dev-only）
 *
 * 面板样式不含任何写死色值，全部从 `--vscode-*` 派生（见 src/ui/components/styles.ts）。
 * 要让预览里的观感与真实侧边栏一致，就必须注入同一套变量。
 *
 * 主题文件是 include 链（dark_modern → dark_plus → dark_vs），取**最先出现**的定义
 * 即最具体的那个 —— 与 VS Code 的合并顺序一致（后面的 include 是更通用的基底）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Cursor 捆绑的默认主题所在目录（相对 resources/app） */
const THEME_DIR_FROM_APP = join('extensions', 'theme-defaults', 'themes')

export const KNOWN_THEMES = [
  'dark_modern',
  'dark_plus',
  'dark_vs',
  'light_modern',
  'light_plus',
  'light_vs',
  'hc_black',
  'hc_light',
]

/**
 * 色彩注册表的默认值 —— 主题 JSON 里**不会写**、但宿主确实会注入的那些项。
 *
 * 这是预览与真实宿主最容易对不上的地方：面板样式里 `var(--vscode-xxx)` 取的是
 * 宿主注入的变量，而宿主把这些变量的值来自注册表（主题文件只覆盖其中一部分）。
 * 只按主题 JSON 生成变量，会让一批取值静默落空、退到面板自己的兜底 ——
 * 表现就是"预览里某个浮层是半透明的，装进 Cursor 却不是"。
 *
 * `inherits` 表示该注册项的默认值就是另一个色彩项（VS Code 的注册表里允许这样写），
 * 展开时按继承链解析，与宿主行为一致。
 *
 * 取值来源：workbench 里 `ln("id", {dark, light, hcDark, hcLight})` 的字面注册。
 */
const REGISTRY_DEFAULTS = {
  'editorWidget.background': { dark: '#252526', light: '#F3F3F3', hcDark: '#0C141F', hcLight: '#FFFFFF' },
  'editorWidget.border': { dark: '#454545', light: '#C8C8C8', hcDark: '#454545', hcLight: '#C8C8C8' },
  // workbench 里 editorWidget.foreground 注册的默认值就是 foreground 本身
  'editorWidget.foreground': { inherits: 'foreground' },
  // 这三个在注册表里就是直接引用同名的 editorWidget 项，所以是实色而不是透明
  'editorHoverWidget.background': { inherits: 'editorWidget.background' },
  'editorHoverWidget.foreground': { inherits: 'editorWidget.foreground' },
  'editorHoverWidget.border': { inherits: 'editorWidget.border' },
  'editorWarning.foreground': { dark: '#CCA700', light: '#BF8803', hcDark: '#FFD370', hcLight: '#895503' },
  'charts.green': { dark: '#89D185', light: '#388A34', hcDark: '#89D185', hcLight: '#374E06' },
  'charts.orange': { dark: '#D18616', light: '#D18616', hcDark: '#D18616', hcLight: '#D18616' },
  'charts.red': { dark: '#F14C4C', light: '#E51400', hcDark: '#F14C4C', hcLight: '#B5200D' },
}

/**
 * 按主题深浅挑选色值。
 *
 * 优先看主题 JSON 的 type 字段，拿不到再退回按名字前缀猜 —— 主题名不足以判断深浅。
 */
function detectIsLight(theme, themeName) {
  if (theme?.type === 'light')
    return true
  if (theme?.type === 'dark' || theme?.type === 'hcDark')
    return false
  return themeName.startsWith('light') || themeName === 'hc_light'
}

function pickByKind(entry, isLight) {
  const order = isLight
    ? ['light', 'hcLight', 'dark', 'hcDark']
    : ['dark', 'hcDark', 'light', 'hcLight']
  for (const kind of order) {
    if (entry[kind] !== undefined)
      return entry[kind]
  }
  return undefined
}

/**
 * 把注册表默认值展开成 色彩id → 色值。
 *
 * 解析顺序刻意是「主题值 → 注册表默认值」：主题里写了的项以主题为准，
 * 主题没写的才走注册表 —— 这正是真实宿主的合并顺序。
 *
 * `inherits` 沿链解析（editorHoverWidget.background → editorWidget.background），
 * 与 VS Code 注册表的行为一致，所以继承出来的也是实色而不是透明。
 */
function expandRegistryDefaults(isLight, themeColors) {
  const resolved = {}
  const resolving = new Set()

  const resolve = (id) => {
    if (resolved[id] !== undefined)
      return resolved[id]
    const fromTheme = themeColors[id]
    if (fromTheme !== undefined) {
      resolved[id] = fromTheme
      return fromTheme
    }
    const entry = REGISTRY_DEFAULTS[id]
    if (!entry)
      return undefined
    if (resolving.has(id))
      return undefined
    resolving.add(id)
    const value = entry.inherits !== undefined
      ? resolve(entry.inherits)
      : pickByKind(entry, isLight)
    resolving.delete(id)
    resolved[id] = value
    return value
  }

  for (const id of Object.keys(REGISTRY_DEFAULTS))
    resolve(id)
  return resolved
}

/**
 * 主题颜色 id → CSS 变量名。
 *
 * VS Code 在 webview 里把主题色注入成 `--vscode-<id>`，其中 id 里的 `.` 换成 `-`，
 * 大小写原样保留：`editorWidget.background` → `--vscode-editorWidget-background`。
 * 面板样式（styles.ts）就是按这个命名去取色的，所以这里必须做同样的转换 ——
 * 少了这一步，取色会全部落空，面板显示的是各处的兜底色而不是用户主题。
 */
function cssVarName(colorId) {
  return `--vscode-${colorId.replace(/\./g, '-')}`
}

/**
 * 沿 include 链收集颜色，先出现的优先。
 * 返回主题颜色 id（如 `editor.background`）到色值的映射。
 */
function collectColors(themeFilePath, seen = new Set()) {
  const absolutePath = resolve(themeFilePath)
  if (seen.has(absolutePath) || !existsSync(absolutePath))
    return {}
  seen.add(absolutePath)

  const theme = JSON.parse(readFileSync(absolutePath, 'utf-8'))
  const inherited = theme.include
    ? collectColors(join(dirname(absolutePath), theme.include), seen)
    : {}

  return { ...inherited, ...(theme.colors ?? {}) }
}

/**
 * 生成注入用的 CSS 文本。
 *
 * 变量分两层合并，与真实宿主的顺序一致：
 *   1. 主题 JSON（include 链展开）—— 用户主题写了什么就是什么
 *   2. 色彩注册表默认值 —— 主题没写的项（editorHoverWidget.* 等）由宿主的注册表兜底
 * 最后再叠一层面板自己的保险值（theme JSON 与注册表都没有的项）。
 *
 * 少了第 2 层，`--vscode-editorHoverWidget-background` 之类的变量会缺失，
 * 面板里的 var(...) 落回自己的兜底 —— 预览里浮层就变成半透明的，
 * 而装在 Cursor 里正常。这正是"预览和线上不一致"的来源。
 */
export function buildThemeCss(cursorAppRoot, themeName) {
  const themeFilePath = join(cursorAppRoot, THEME_DIR_FROM_APP, `${themeName}.json`)
  const colors = collectColors(themeFilePath)

  let themeType
  try {
    themeType = JSON.parse(readFileSync(themeFilePath, 'utf-8'))?.type
  }
  catch {
    themeType = undefined
  }
  const isLight = detectIsLight({ type: themeType }, themeName)

  const lastResort = isLight
    ? {
        'foreground': '#3B3B3B',
        'editor.background': '#FFFFFF',
        'editorWidget.background': '#F3F3F3',
        'button.background': '#0078D4',
        'button.foreground': '#FFFFFF',
      }
    : {
        'foreground': '#CCCCCC',
        'editor.background': '#1F1F1F',
        'editorWidget.background': '#252526',
        'button.background': '#0E639C',
        'button.foreground': '#FFFFFF',
      }

  // 顺序即优先级：主题 > 注册表默认 > 面板保险值
  const registry = expandRegistryDefaults(isLight, colors)
  const merged = { ...lastResort, ...registry, ...colors }

  const declarations = Object.entries(merged)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([colorId, value]) => `${cssVarName(colorId)}: ${value};`)
    .join('\n      ')

  // 面板 body 是透明的，背景由宿主提供 —— 预览里用 editor.background 顶上
  return `
    :root {
      ${declarations}
    }
    html, body { background: ${merged['editor.background']}; }
  `
}
