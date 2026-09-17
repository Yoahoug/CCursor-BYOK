/**
 * Webview CSS — 完全跟随宿主主题的令牌层
 *
 * 面板嵌在编辑器旁边，任何"自带配色"都会和周围割裂：换一个主题就得重新对齐
 * 一次色值，而且永远对不准。所以这里只保留一层令牌，取值全部从 --vscode-* 派生：
 *
 *   - body 背景透明 —— 直接透出侧边栏/编辑器底色，主题一换自动跟着变
 *   - 文字取 --vscode-foreground —— 任意主题下都是与背景反差的那个前景色
 *   - 卡片 / 边框 / 分隔用当前前景色的低透明度叠加（color-mix）：
 *     浅色主题下叠出浅灰，深色主题下叠出浅白，同一组值两边都成立
 *
 * 因此不再需要 data-theme 与暗色变量表，也就不会出现"某个控件漏了配色"的情况。
 */

export const styles = /* css */ `
  /* ── 设计令牌 ───────────────────────────────────────────── */
  :root {
    /* 叠加用的"墨水"：所有派生色的基准，跟着主题走 */
    --cpp-ink: var(--vscode-foreground, #24282e);

    --cpp-bg: transparent;
    --cpp-surface: color-mix(in srgb, var(--cpp-ink) 4%, transparent);
    --cpp-surface-2: color-mix(in srgb, var(--cpp-ink) 7%, transparent);
    --cpp-surface-3: color-mix(in srgb, var(--cpp-ink) 11%, transparent);
    --cpp-border: color-mix(in srgb, var(--cpp-ink) 13%, transparent);
    --cpp-border-strong: color-mix(in srgb, var(--cpp-ink) 26%, transparent);

    --cpp-text: var(--cpp-ink);
    --cpp-text-dim: color-mix(in srgb, var(--cpp-ink) 72%, transparent);
    --cpp-text-faint: color-mix(in srgb, var(--cpp-ink) 52%, transparent);

    /* 强调色直接用宿主按钮色，深浅主题下都已经是"可读的强调色" */
    --cpp-accent: var(--vscode-button-background, #4a6c96);
    --cpp-accent-hover: var(--vscode-button-hoverBackground, #3d5b80);
    --cpp-accent-fg: var(--vscode-button-foreground, #ffffff);
    --cpp-accent-soft: color-mix(in srgb, var(--cpp-accent) 24%, transparent);

    /* 语义色优先取 VS Code 那几组"当前景使用"的颜色，而不是图表填充色 */
    --cpp-ok: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #2c7a52));
    --cpp-warn: var(--vscode-editorWarning-foreground, var(--vscode-charts-orange, #8a6524));
    --cpp-danger: var(--vscode-errorForeground, var(--vscode-charts-red, #b4453a));
    --cpp-ok-soft: color-mix(in srgb, var(--cpp-ok) 14%, transparent);
    --cpp-ok-border: color-mix(in srgb, var(--cpp-ok) 34%, transparent);
    --cpp-warn-soft: color-mix(in srgb, var(--cpp-warn) 14%, transparent);
    --cpp-warn-border: color-mix(in srgb, var(--cpp-warn) 34%, transparent);
    --cpp-danger-soft: color-mix(in srgb, var(--cpp-danger) 14%, transparent);
    --cpp-danger-border: color-mix(in srgb, var(--cpp-danger) 34%, transparent);

    --cpp-tip-soft: color-mix(in srgb, var(--cpp-ink) 6%, transparent);
    --cpp-tip-border: color-mix(in srgb, var(--cpp-ink) 16%, transparent);
    --cpp-on-track: var(--vscode-button-background, #4a6c96);
    --cpp-off-track: color-mix(in srgb, var(--cpp-ink) 24%, transparent);
    --cpp-knob: var(--vscode-button-foreground, #ffffff);

    --cpp-radius: 8px;
    --cpp-radius-sm: 6px;
    --cpp-radius-pill: 999px;
    --cpp-shadow: 0 1px 2px color-mix(in srgb, var(--cpp-ink) 10%, transparent);
    --cpp-shadow-lg: 0 6px 20px color-mix(in srgb, var(--cpp-ink) 28%, transparent);

    /* ── 浮层毛玻璃 ──
       与 surface 系列刻意分开。surface 是"当前前景色的低透明度叠加"（4~11% 墨水），
       衬在面板上做卡片背景刚好；但拿它当**浮层**底色就等于全透明 —— 底下的文字会
       直接透上来和选项叠在一起，两层字互相干扰，谁都读不清。

       浮层改用 editorWidget 背景作基底（主题里本来就是给下拉/悬浮件的那个颜色），
       再叠背景模糊：半透明、能透出环境色，但底下的内容被虚化到不影响阅读。
       这就是 macOS 那种毛玻璃的观感，同时不引入任何写死的色值。 */
    --cpp-glass-bg: color-mix(in srgb, var(--cpp-editor-widget-bg) 86%, transparent);
    --cpp-glass-blur: saturate(180%) blur(20px);
    --cpp-glass-border: color-mix(in srgb, var(--cpp-ink) 20%, transparent);
    --cpp-glass-shadow: 0 12px 32px color-mix(in srgb, var(--cpp-ink) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--cpp-ink) 16%, transparent);

    /* ── 宿主悬浮件底色 ──
       editorHoverWidget.* / editorWidget.* 这几个颜色 VS Code 是**有值**的，但值来自
       色彩注册表的默认项（editorHoverWidget.background 默认 = editorWidget.background，
       border 默认 = editorWidget.border），而不是主题 JSON。主题文件里查不到它们，
       直接 var(--vscode-editorHoverWidget-background) 会落回下面的兜底 —— 于是浮层
       变成半透明。这里按注册表的继承关系写全兜底链，让取值与真实宿主一致。

       兜底的深浅色值取自 workbench 的注册表默认（editorWidget.background 深 #252526 /
       浅 #F3F3F3，border 深 #454545 / 浅 #C8C8C8）。各变量内部先试主题值，
       再退到这一层。 */
    --cpp-editor-widget-bg: var(
      --vscode-editorWidget-background,
      var(--vscode-editor-background, #252526)
    );
    --cpp-editor-widget-border: var(
      --vscode-editorWidget-border,
      color-mix(in srgb, var(--cpp-ink) 26%, transparent)
    );
    --cpp-hover-bg: var(--vscode-editorHoverWidget-background, var(--cpp-editor-widget-bg));
    --cpp-hover-border: var(--vscode-editorHoverWidget-border, var(--cpp-editor-widget-border));
    --cpp-hover-fg: var(--vscode-editorHoverWidget-foreground, var(--cpp-text));

    /* ── 弹窗材质 ──
       弹窗盖在**已有内容**之上，这里的透明是有害的：底下表单的文字会透上来和
       弹窗自己的文字叠在一起，两层字互相干扰，谁都读不清 —— 观感上就是"脏"。

       glass 那套（86% + 模糊）是给下拉这种贴着触发器的小浮层用的，弹窗用它会
       留下一层灰蒙蒙的鬼影，所以弹窗直接用不透明的控件底色：主题里
       editorWidget.background 本来就是给这类浮层的颜色，两边主题都成立。

       阴影用黑而不是 --cpp-ink（前景色）：深色主题下 ink 接近白色，
       拿它做阴影会变成一圈发白的光晕，浮不起来。 */
    --cpp-modal-bg: var(--cpp-editor-widget-bg);
    --cpp-modal-border: var(--cpp-editor-widget-border);
    --cpp-modal-scrim: color-mix(in srgb, #000 58%, transparent);
    --cpp-modal-shadow: 0 16px 40px rgba(0, 0, 0, 0.42), 0 3px 10px rgba(0, 0, 0, 0.26);
    --cpp-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
    --cpp-font: var(--vscode-font-family, -apple-system, "Segoe UI", system-ui, sans-serif);
    --cpp-fs: 12px;
  }

  /* ── 基础 ──────────────────────────────────────────────── */
  * { box-sizing: border-box; }
  /* html 也要显式透明：宿主给 webview 的默认底色画在 html 上，只设 body 会留白 */
  html, body { background: transparent; }
  body {
    font-family: var(--cpp-font);
    font-size: var(--cpp-fs);
    line-height: 1.45;
    color: var(--cpp-text);
    padding: 0 12px 18px;
    margin: 0;
    -webkit-font-smoothing: antialiased;
  }
  [x-cloak] { display: none !important; }

  h3 {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--cpp-text-faint);
    margin: 16px 0 8px;
    padding: 0;
    border: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h3 .h3-actions { display: flex; gap: 4px; align-items: center; }

  /* ── 按钮 ──────────────────────────────────────────────── */
  button {
    background: var(--cpp-accent);
    color: var(--cpp-accent-fg);
    border: 1px solid transparent;
    padding: 5px 11px;
    border-radius: var(--cpp-radius-sm);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    line-height: 1.4;
    transition: background-color 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
  }
  button:hover:not(:disabled) { background: var(--cpp-accent-hover); }
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible { outline: 2px solid var(--cpp-accent); outline-offset: 1px; }

  button.secondary {
    background: var(--cpp-surface);
    color: var(--cpp-text);
    border-color: var(--cpp-border-strong);
  }
  button.secondary:hover:not(:disabled) { background: var(--cpp-surface-2); }
  button.danger { background: transparent; color: var(--cpp-danger); padding: 3px 7px; }
  button.danger:hover:not(:disabled) { background: var(--cpp-danger-soft); }
  button.ghost { background: transparent; color: var(--cpp-text-dim); padding: 3px 7px; font-weight: 500; }
  button.ghost:hover:not(:disabled) { background: var(--cpp-surface-2); color: var(--cpp-text); }
  button.tiny { padding: 3px 8px; font-size: 10px; }

  /* ── 表单 ──────────────────────────────────────────────── */
  input:not([type=checkbox]):not([type=radio]), select, textarea {
    width: 100%;
    background: var(--cpp-surface);
    color: var(--cpp-text);
    border: 1px solid var(--cpp-border-strong);
    padding: 5px 8px;
    font-size: 11px;
    border-radius: var(--cpp-radius-sm);
    outline: none;
    font-family: var(--cpp-mono);
    resize: vertical;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  input:not([type=checkbox]):not([type=radio]):focus, select:focus, textarea:focus {
    border-color: var(--cpp-accent);
    box-shadow: 0 0 0 3px var(--cpp-accent-soft);
  }
  input[type=radio], input[type=checkbox] { outline: none; accent-color: var(--cpp-accent); }
  input::placeholder, textarea::placeholder { color: var(--cpp-text-faint); }

  /* 禁用态强调 — 删除线表达"值保留但不生效"(如 Max Output Tokens 的 Off 开关) */
  input:not([type=checkbox]):not([type=radio]):disabled, select:disabled, textarea:disabled {
    opacity: 0.5;
    color: var(--cpp-text-faint);
    border-style: dashed;
    text-decoration: line-through;
    cursor: not-allowed;
  }

  /* 移除 number input 的原生 spinner — 视觉冗余, 用户直接输入数字即可 */
  input[type=number] { -moz-appearance: textfield; }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

  label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    color: var(--cpp-text-dim);
    margin: 8px 0 3px;
    /* 不再强制大写：侧边栏窄，全大写 + 字距会把 "Context Token Limit" 这类长标签
       顶出列宽导致截断，行与行也因此对不齐。正常大小写既放得下也更安静。 */
    text-transform: none;
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }
  .label-note {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    color: var(--cpp-text-faint);
    font-size: 10px;
  }
  /*
    带注解的字段名强制排在一行。
    注解是字段名的后缀说明（"models can override" / "optional, JSON"），
    侧边栏窄，一旦折到下一行就会被读成另一个字段名。
    用 :has() 只作用于确实带注解的标签 —— 那些本身就长到需要折行的标签
    （比如 Tooltip 那一项）不受影响，还能正常折。
  */
  label:has(> .label-note) {
    display: flex;
    align-items: baseline;
    gap: 4px;
    flex-wrap: nowrap;
    white-space: nowrap;
    min-width: 0;
  }
  label:has(> .label-note) > .label-note {
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint { font-size: 10px; color: var(--cpp-text-faint); line-height: 1.5; margin-top: 4px; }
  .err { color: var(--cpp-danger); font-size: 10px; margin-top: 3px; }
  .req { color: var(--cpp-danger); font-weight: 400; }
  input.invalid, textarea.invalid { border-color: var(--cpp-danger); }

  .field { margin-bottom: 8px; }
  /* minmax(0, 1fr) 而非 1fr：网格项默认 min-width:auto，长 URL / 长数字输入框会把
     列顶宽，两列就此错位。minmax(0,·) 才允许子项真正收缩。 */
  .field-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    align-items: start;
  }
  .field-row > * { min-width: 0; }

  /* ── 分段控件（协议两级选择） ─────────────────────────── */
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--cpp-surface-2);
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius-sm);
  }
  .seg-btn {
    flex: 1;
    min-width: 0;
    background: transparent;
    color: var(--cpp-text-dim);
    border: none;
    border-radius: 5px;
    padding: 5px 6px;
    font-size: 10px;
    font-weight: 600;
    /* 一行居中，不折行。
       侧边栏很窄，三档并排时每档只有 ~60px；"Anthropic Messages" 这类长标签会被
       折成两行，三个按钮高度就此不齐。所以标签本身已改成短名（见
       PROTOCOL_FAMILY_OPTIONS），这里再用 nowrap 兜一层：宁可挤一点也不折行。 */
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .seg-btn:hover:not(:disabled) { background: var(--cpp-surface-3); color: var(--cpp-text); }
  .seg-btn.active {
    background: var(--cpp-surface);
    color: var(--cpp-accent);
    box-shadow: var(--cpp-shadow);
  }
  .seg-path { font-family: var(--cpp-mono); font-size: 9px; font-weight: 400; color: inherit; opacity: 0.75; }

  /* ── 最终请求地址预览 ─────────────────────────────────── */
  .endpoint {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 6px;
    padding: 6px 8px;
    background: var(--cpp-surface-2);
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius-sm);
  }
  .endpoint-label {
    flex: 0 0 auto;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--cpp-text-faint);
  }
  .endpoint-url {
    flex: 1;
    min-width: 0;
    font-family: var(--cpp-mono);
    font-size: 10px;
    color: var(--cpp-text);
    overflow-wrap: anywhere;
  }

  /* ── 提示条 ───────────────────────────────────────────── */
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 6px;
    padding: 7px 9px;
    font-size: 10px;
    line-height: 1.5;
    border-radius: var(--cpp-radius-sm);
    background: var(--cpp-tip-soft);
    border: 1px solid var(--cpp-tip-border);
    color: var(--cpp-text);
  }
  .notice-text { flex: 1; min-width: 0; }
  .notice button { flex: 0 0 auto; }
  .notice-warn { background: var(--cpp-warn-soft); border-color: var(--cpp-warn-border); }
  .notice-bad { background: var(--cpp-danger-soft); border-color: var(--cpp-danger-border); }

  /* ── 徽标 ─────────────────────────────────────────────── */
  .badge {
    flex: 0 0 auto;
    background: var(--cpp-surface-2);
    color: var(--cpp-text-dim);
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius-pill);
    padding: 1px 7px;
    font-size: 9px;
    font-weight: 600;
    font-family: var(--cpp-mono);
    white-space: nowrap;
  }
  .badge:hover:not(:disabled) { background: var(--cpp-surface-3); }
  .badge-ok { background: var(--cpp-ok-soft); border-color: var(--cpp-ok-border); color: var(--cpp-ok); }
  .badge-ok:hover:not(:disabled) { background: var(--cpp-ok-soft); }
  .badge-bad { background: var(--cpp-danger-soft); border-color: var(--cpp-danger-border); color: var(--cpp-danger); }
  .badge-bad:hover:not(:disabled) { background: var(--cpp-danger-soft); }

  /* ── 连通性测试 ───────────────────────────────────────── */
  .test-row { display: flex; align-items: center; gap: 8px; }
  .test-card {
    margin-top: 6px;
    padding: 8px 9px;
    border-radius: var(--cpp-radius-sm);
    background: var(--cpp-ok-soft);
    border: 1px solid var(--cpp-ok-border);
  }
  .test-card-bad { background: var(--cpp-danger-soft); border-color: var(--cpp-danger-border); }
  .test-card-idle { background: var(--cpp-surface-2); border-color: var(--cpp-border); }
  .test-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .test-card-summary { font-size: 11px; font-weight: 700; }
  .test-card-bad .test-card-summary { color: var(--cpp-danger); }
  .test-card:not(.test-card-bad):not(.test-card-idle) .test-card-summary { color: var(--cpp-ok); }
  .test-metrics { margin-top: 4px; font-size: 10px; font-family: var(--cpp-mono); color: var(--cpp-text-dim); }
  .test-error-kind { margin-top: 4px; font-size: 10px; font-weight: 700; color: var(--cpp-danger); }
  .test-error-msg {
    display: block;
    margin-top: 4px;
    font-family: var(--cpp-mono);
    font-size: 10px;
    color: var(--cpp-text-dim);
    overflow-wrap: anywhere;
  }
  .test-raw { margin-top: 6px; }
  .test-raw summary { font-size: 10px; color: var(--cpp-text-dim); cursor: pointer; }
  .test-raw pre {
    margin: 4px 0 0;
    padding: 6px 8px;
    max-height: 180px;
    overflow: auto;
    background: var(--cpp-surface);
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius-sm);
    font-family: var(--cpp-mono);
    font-size: 10px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--cpp-text);
  }

  /* ── 协议自动识别 / 连通性测试 ────────────────────────── */
  /*
    并排两个按钮：识别是排错主路径（不知道该选哪套协议时用它），测试是确认可用性。
    识别结果里"每种协议各自报了什么错"比"只有一种能通"信息量大，所以失败时
    保留明细（model-card 里的 <details>）。
  */
  .probe { margin-top: 7px; padding-top: 7px; border-top: 1px dashed var(--cpp-border); }
  .probe-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 5px; }
  .probe-label { font-size: 9px; color: var(--cpp-text-faint); line-height: 1.5; }
  .probe-buttons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }

  /* ── 子页签 ───────────────────────────────────────────── */
  /*
    用下划线式而非按钮式：它切换的是整页内容，做成按钮会和页内的操作按钮混淆。
  */
  .tabs {
    display: flex;
    gap: 2px;
    margin: 4px -12px 2px;
    padding: 0 12px;
    border-bottom: 1px solid var(--cpp-border);
  }
  .tab {
    background: transparent;
    color: var(--cpp-text-dim);
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 7px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .tab:hover:not(.active) { background: transparent; color: var(--cpp-text); }
  .tab.active {
    color: var(--cpp-accent);
    border-bottom-color: var(--cpp-accent);
  }

  /* 模型头部上的协议标签 —— 只在模型单独指定了协议时才出现 */
  .model-proto-tag {
    font-size: 9px;
    font-weight: 600;
    color: var(--cpp-text-dim);
    background: var(--cpp-surface-3);
    border-radius: 999px;
    padding: 1px 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* ── 顶部横幅 ─────────────────────────────────────────── */
  .byok-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 12px 12px 14px;
    margin: 0 -12px 4px;
    background: linear-gradient(180deg, var(--cpp-surface), var(--cpp-surface-2));
    border-bottom: 1px solid var(--cpp-border);
  }
  .byok-banner .byok-label { display: flex; flex-direction: column; min-width: 0; }
  .byok-banner .byok-title { font-weight: 700; font-size: 12px; letter-spacing: -0.01em; }
  .byok-banner .byok-hint { font-size: 10px; color: var(--cpp-text-faint); margin-top: 2px; }
  .byok-banner .banner-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .byok-banner button.on { background: var(--cpp-ok); color: #fff; }
  .byok-banner button.on:hover:not(:disabled) { background: var(--cpp-ok); opacity: 0.9; }
  .byok-banner button.off { background: var(--cpp-warn); color: #fff; }
  /* 主题不再提供手动切换 —— 面板跟随编辑器配色，少一个与用户目标无关的开关 */
  .byok-banner button.off:hover:not(:disabled) { background: var(--cpp-warn); opacity: 0.9; }

  /* ── 状态点 ───────────────────────────────────────────── */
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: 0 0 auto; background: var(--cpp-text-faint); }
  .dot-ok { background: var(--cpp-ok); }
  .dot-warn { background: var(--cpp-warn); }
  .dot-bad { background: var(--cpp-danger); }
  .server-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 11px; color: var(--cpp-text-dim); }
  .server-row .server-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-actions { display: flex; gap: 4px; }

  .row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; font-size: 12px; gap: 8px; }

  /* ── 门禁式空状态 ─────────────────────────────────────── */
  .gate {
    text-align: center;
    padding: 22px 16px;
    margin: 6px 0;
    background: var(--cpp-surface);
    border: 1px dashed var(--cpp-border-strong);
    border-radius: var(--cpp-radius);
  }
  .gate-title { font-size: 12px; font-weight: 700; }
  .gate-text { font-size: 11px; color: var(--cpp-text-dim); margin: 6px 0 12px; line-height: 1.5; }
  .gate-actions { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }

  .empty { font-size: 11px; color: var(--cpp-text-faint); padding: 14px 0; text-align: center; }

  /* ── Provider 折叠面板 ───────────────────────────────── */
  .acc {
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius);
    margin-bottom: 8px;
    background: var(--cpp-surface);
    box-shadow: var(--cpp-shadow);
    overflow: hidden;
    transition: border-color 0.12s ease;
  }
  .acc.dirty { border-color: var(--cpp-warn-border); }
  .acc-head { display: flex; align-items: center; gap: 7px; padding: 9px 10px; cursor: pointer; user-select: none; }
  .acc-head:hover { background: var(--cpp-surface-2); }
  .acc-caret { font-size: 8px; color: var(--cpp-text-faint); width: 9px; display: inline-block; flex: 0 0 auto; }
  .acc-title { flex: 1; font-size: 12px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acc-type {
    flex: 0 0 auto;
    font-size: 9px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: var(--cpp-radius-pill);
    background: var(--cpp-accent-soft);
    color: var(--cpp-accent);
    white-space: nowrap;
    letter-spacing: 0.01em;
  }
  .acc-meta { flex: 0 0 auto; font-size: 10px; color: var(--cpp-text-faint); }
  .acc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cpp-warn); display: inline-block; flex: 0 0 auto; }
  .acc-sort { flex: 0 0 auto; display: flex; flex-direction: column; gap: 0; margin-left: 2px; }
  .sort-btn {
    background: transparent;
    border: none;
    color: var(--cpp-text-faint);
    cursor: pointer;
    padding: 0 2px;
    font-size: 8px;
    line-height: 1;
    min-width: auto;
  }
  .sort-btn:hover:not(:disabled) { background: transparent; color: var(--cpp-text); }
  .acc-body { padding: 4px 11px 11px; border-top: 1px solid var(--cpp-border); }

  .actions-bar {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    align-items: center;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--cpp-border);
  }

  /* ── 下拉选择器 ───────────────────────────────────────── */
  .custom-select { position: relative; width: 100%; }
  .custom-select-trigger {
    display: flex;
    align-items: center;
    width: 100%;
    background: var(--cpp-surface);
    color: var(--cpp-text);
    border: 1px solid var(--cpp-border-strong);
    padding: 5px 8px;
    font-size: 11px;
    border-radius: var(--cpp-radius-sm);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    font-weight: 500;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .custom-select-trigger:hover { border-color: var(--cpp-accent); background: var(--cpp-surface); }
  .custom-select-trigger:focus { outline: none; border-color: var(--cpp-accent); box-shadow: 0 0 0 3px var(--cpp-accent-soft); }
  .custom-select-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .custom-select-caret { opacity: 0.5; font-size: 8px; margin-left: 6px; }
  .custom-select-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    right: 0;
    z-index: 50;
    /* 浮层必须是"能盖住底下内容"的材质 —— 用 surface 那套 4% 叠加的话，
       底下字段的文字会透上来和选项叠在一起。见 --cpp-glass-bg 的说明。 */
    background: var(--cpp-glass-bg);
    backdrop-filter: var(--cpp-glass-blur);
    border: 1px solid var(--cpp-glass-border);
    border-radius: var(--cpp-radius-sm);
    box-shadow: var(--cpp-glass-shadow);
    max-height: 240px;
    overflow-y: auto;
    padding: 3px;
  }
  .custom-select-option {
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
    color: var(--cpp-text);
    border-radius: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .custom-select-option.hover,
  .custom-select-option:hover { background: var(--cpp-surface-2); }
  .custom-select-option.selected { background: var(--cpp-accent-soft); color: var(--cpp-accent); font-weight: 600; }

  /* ── 模型名自动补全 ───────────────────────────────────── */
  .autocomplete { position: relative; }
  .ac-input-wrap { display: flex; align-items: stretch; }
  .ac-input-wrap input { flex: 1; border-top-right-radius: 0; border-bottom-right-radius: 0; border-right: none; min-width: 0; }
  .ac-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    padding: 0;
    border: 1px solid var(--cpp-border-strong);
    border-left: none;
    border-radius: 0 var(--cpp-radius-sm) var(--cpp-radius-sm) 0;
    background: var(--cpp-surface);
    color: var(--cpp-text-dim);
    cursor: pointer;
    font-size: 14px;
    min-width: auto;
    line-height: 1;
  }
  .ac-toggle:hover:not(:disabled) { background: var(--cpp-surface-2); color: var(--cpp-text); }
  .ac-toggle-caret { display: inline-block; transition: transform 0.15s ease; }
  .ac-toggle-caret.open { transform: rotate(180deg); }
  .ac-loading { display: flex; align-items: center; justify-content: center; padding: 12px 0; }
  @keyframes ac-spin { to { transform: rotate(360deg); } }
  .ac-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--cpp-border-strong);
    border-top-color: var(--cpp-accent);
    border-radius: 50%;
    animation: ac-spin 0.6s linear infinite;
  }
  .autocomplete-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 20;
    /* 与 custom-select 同一套浮层材质：模糊 + 半透明。
       这条尤其重要 —— 候选项是多行文本，透出底下的 Protocol、Final URL 会直接糊成一片。 */
    background: var(--cpp-glass-bg);
    backdrop-filter: var(--cpp-glass-blur);
    border: 1px solid var(--cpp-glass-border);
    border-radius: var(--cpp-radius-sm);
    box-shadow: var(--cpp-glass-shadow);
    max-height: 200px;
    overflow-y: auto;
    margin-top: 3px;
  }
  .autocomplete-item { padding: 5px 8px; cursor: pointer; font-size: 11px; border-bottom: 1px solid var(--cpp-border); }
  .autocomplete-item:last-child { border-bottom: none; }
  .autocomplete-item:hover, .autocomplete-item.selected { background: var(--cpp-accent-soft); }
  .autocomplete-item .ac-name { font-weight: 600; }
  .autocomplete-item .ac-id { font-family: var(--cpp-mono); font-size: 10px; color: var(--cpp-text-faint); margin-top: 1px; }
  .autocomplete-item .ac-meta { font-size: 10px; color: var(--cpp-text-faint); margin-top: 1px; }

  /* ── Models 区域 ──────────────────────────────────────── */
  .models-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--cpp-border); }
  .models-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .models-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--cpp-text-faint); }
  .models-header-actions { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }

  .model-item {
    position: relative;
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius-sm);
    margin-bottom: 5px;
    background: var(--cpp-surface-2);
    overflow: hidden;
  }

  /* ── 拖动排序 ──
     插入位置用伪元素画线，不用 border：改 border 会让卡片高度变化，
     鼠标一移动整个列表就跟着抖，很难把卡片放到想要的位置。 */
  .model-item.model-drop-top::before,
  .model-item.model-drop-bottom::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--cpp-accent);
    pointer-events: none;
    z-index: 2;
  }
  .model-item.model-drop-top::before { top: 0; }
  .model-item.model-drop-bottom::after { bottom: 0; }

  /* 被拖走的卡片留一个"空位"提示。不用 display:none —— 那会让下方卡片
     立刻补位，用户就丢失了"我从哪里拖出来"的参照 */
  .model-item.model-dragging {
    opacity: 0.4;
    border-style: dashed;
  }

  /* 握把：两列圆点。不依赖图标字体 —— codicon 里没有 gripper 类图标，
     而且这个面板只内联了一个 @font-face，取不到图标就会显示成空白方块 */
  .model-drag-handle {
    flex: 0 0 auto;
    width: 9px;
    height: 14px;
    margin-right: -1px;
    cursor: grab;
    background-image: radial-gradient(circle, var(--cpp-text-faint) 1px, transparent 1.2px);
    background-size: 4px 4px;
    background-position: 1px 2px;
    background-repeat: repeat;
    opacity: 0.75;
  }
  .model-drag-handle:hover { opacity: 1; }
  .model-drag-handle:active { cursor: grabbing; }

  .model-head { display: flex; align-items: center; gap: 7px; padding: 6px 8px; cursor: pointer; user-select: none; font-size: 11px; }
  .model-head:hover { background: var(--cpp-surface-3); }
  .model-body { padding: 4px 10px 10px; border-top: 1px solid var(--cpp-border); background: var(--cpp-surface); }
  .model-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .model-empty { font-size: 10px; color: var(--cpp-text-faint); font-style: italic; padding: 6px 0; }

  /* 模型标题栏右侧 defaultOn 开关 — iOS 风格 toggle switch */
  .model-switch {
    position: relative;
    display: inline-block;
    width: 32px;
    height: 18px;
    flex: 0 0 32px;
    cursor: pointer;
    vertical-align: middle;
    /* 覆盖全局 label { opacity/text-transform/... } — 那是给字段标签用的 */
    opacity: 1;
    text-transform: none;
    letter-spacing: normal;
    margin: 0;
  }
  .model-switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; z-index: 3; }
  .model-switch-track {
    position: absolute;
    inset: 0;
    background: var(--cpp-off-track);
    border: 1px solid transparent;
    border-radius: 9px;
    transition: background-color 0.15s ease;
    z-index: 1;
    pointer-events: none;
    box-sizing: border-box;
  }
  .model-switch-knob {
    position: absolute;
    left: 3px;
    top: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--cpp-knob);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s ease;
    z-index: 2;
    pointer-events: none;
  }
  .model-switch input:checked ~ .model-switch-track { background: var(--cpp-on-track); }
  .model-switch input:checked ~ .model-switch-knob { transform: translateX(14px); }

  /* ── 远程模型列表 ─────────────────────────────────────── */
  .models-loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--cpp-bg) 78%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--cpp-radius);
    backdrop-filter: blur(2px);
  }
  .models-loading-spinner { font-size: 11px; color: var(--cpp-text-dim); }
  .remote-models-panel { margin: 6px 0; border: 1px solid var(--cpp-border-strong); border-radius: var(--cpp-radius-sm); overflow: hidden; }
  .remote-models-header { display: flex; justify-content: space-between; align-items: center; padding: 5px 9px; background: var(--cpp-surface-2); }
  .remote-models-title { font-size: 10px; font-weight: 600; color: var(--cpp-text-dim); }
  .remote-models-list { max-height: 200px; overflow-y: auto; background: var(--cpp-surface); }
  /*
    一项两行：主行是可读名，副行是真实 id。
    display_name 与 id 一致时不显示副行（那种情况是重复信息，白占高度）。
    id 用等宽字体：混淆过的 id 是随机串，等宽下更易逐字比对。
  */
  .remote-model-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 9px;
    font-size: 11px;
    cursor: pointer;
    min-width: 0;
  }
  .remote-model-name {
    color: var(--cpp-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remote-model-id {
    font-family: var(--cpp-mono);
    font-size: 9px;
    color: var(--cpp-text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remote-model-item:hover { background: var(--cpp-accent-soft); }
  .remote-model-item:hover .remote-model-name { color: var(--cpp-accent); }
  .remote-model-item:hover .remote-model-id { color: var(--cpp-accent); }

  /* ── Quick Switch ─────────────────────────────────────── */
  .qs-section { margin-top: 8px; border: 1px solid var(--cpp-border); border-radius: var(--cpp-radius-sm); overflow: hidden; }
  .qs-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 9px;
    background: var(--cpp-surface-2);
    border: none;
    color: var(--cpp-text);
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    text-align: left;
    min-width: auto;
    border-radius: 0;
  }
  .qs-header:hover:not(:disabled) { background: var(--cpp-surface-3); }
  .qs-caret { font-size: 9px; color: var(--cpp-text-faint); width: 9px; }
  .qs-hint {
    margin-left: auto;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px solid var(--cpp-border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    color: var(--cpp-text-faint);
    font-weight: 400;
    cursor: help;
  }
  .qs-body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--cpp-surface); }
  .qs-item { border: 1px solid var(--cpp-border); border-radius: var(--cpp-radius-sm); overflow: hidden; background: var(--cpp-surface); }
  .qs-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px; }
  .qs-label { font-size: 11px; font-weight: 600; }
  .qs-item-body { padding: 6px 9px 8px; border-top: 1px solid var(--cpp-border); }
  .qs-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 1;
    margin: 0;
    text-transform: none;
  }
  .qs-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .qs-switch-track { width: 28px; height: 15px; border-radius: 8px; background: var(--cpp-off-track); transition: background 0.15s ease; }
  .qs-switch input:checked + .qs-switch-track { background: var(--cpp-on-track); }
  .qs-switch-knob {
    position: absolute;
    left: 2px;
    top: 50%;
    transform: translateY(-50%);
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--cpp-knob);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: left 0.15s ease;
    pointer-events: none;
  }
  .qs-switch input:checked ~ .qs-switch-knob { left: 15px; }
  .qs-group { display: flex; flex-direction: column; gap: 4px; }
  .qs-chips { display: flex; flex-wrap: wrap; gap: 4px; padding-left: 16px; }
  .qs-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    padding: 2px 7px;
    border: 1px solid var(--cpp-border-strong);
    border-radius: var(--cpp-radius-pill);
    cursor: pointer;
    user-select: none;
    background: var(--cpp-surface);
  }
  .qs-chip input { width: auto; margin: 0; }
  .qs-chip:has(input:checked) { background: var(--cpp-accent-soft); border-color: var(--cpp-accent); color: var(--cpp-accent); font-weight: 600; }
  .qs-tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding-left: 16px; }
  .qs-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    padding: 2px 7px;
    background: var(--cpp-surface-3);
    border-radius: var(--cpp-radius-pill);
    font-weight: 600;
  }
  .qs-tag-x { background: none; border: none; color: var(--cpp-danger); cursor: pointer; font-size: 12px; padding: 0 2px; min-width: auto; line-height: 1; }
  .qs-tag-x:hover:not(:disabled) { background: transparent; }
  .qs-tag-input {
    font-size: 10px;
    padding: 2px 5px;
    width: 100px;
    height: 20px;
    border: 1px dashed var(--cpp-border-strong);
    background: transparent;
    color: var(--cpp-text);
    border-radius: var(--cpp-radius-pill);
  }

  /* ── 能力勾选 + Thinking 子控件 ───────────────────────── */
  .check { display: flex; align-items: center; gap: 4px; font-size: 10px; margin: 0; white-space: nowrap; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--cpp-text-dim); }
  .check input { width: auto; }
  .caps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px 8px;
    margin: 8px 0 6px;
    padding: 8px 0;
    border-top: 1px dashed var(--cpp-border-strong);
    border-bottom: 1px dashed var(--cpp-border-strong);
  }
  .caps .thinking-cell { grid-column: 1 / 2; }
  .caps .thinking-sub-disabled { grid-column: 2 / 4; }
  .caps .thinking-level-cell { grid-column: 2 / 4; }
  .caps .thinking-level-cell .custom-select-trigger { height: 21px; padding: 0 6px; font-size: 10px; }
  .caps .thinking-mode-group { grid-column: 2 / 4; display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; }
  .thinking-mode-tabs { display: flex; flex-shrink: 0; }
  .thinking-mode-tab {
    font-size: 9px;
    padding: 1px 7px;
    border: 1px solid var(--cpp-border-strong);
    background: var(--cpp-surface);
    color: var(--cpp-text-dim);
    cursor: pointer;
    min-width: auto;
    height: 21px;
    border-radius: 0;
    font-weight: 600;
  }
  .thinking-mode-tab:first-child { border-radius: 5px 0 0 5px; }
  .thinking-mode-tab:last-child { border-radius: 0 5px 5px 0; border-left: none; }
  .thinking-mode-tab.active { background: var(--cpp-accent-soft); color: var(--cpp-accent); border-color: var(--cpp-accent); }
  .thinking-mode-tab.active:hover:not(:disabled) { background: var(--cpp-accent-soft); }
  .thinking-mode-value { flex: 1; min-width: 0; }
  .thinking-mode-value .custom-select-trigger { height: 21px; padding: 0 6px; font-size: 10px; }

  /* ── 密钥显示切换 ─────────────────────────────────────── */
  .input-reveal { position: relative; display: flex; align-items: center; }
  .input-reveal input { padding-right: 30px; }
  .reveal-btn {
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    padding: 3px 5px;
    cursor: pointer;
    color: var(--cpp-text-faint);
    min-width: auto;
  }
  .reveal-btn:hover:not(:disabled) { background: transparent; color: var(--cpp-text); }

  .footer { margin-top: 16px; display: flex; gap: 6px; flex-wrap: wrap; }

  /* ── Toast ────────────────────────────────────────────── */
  .toast-container {
    position: fixed;
    bottom: 12px;
    left: 12px;
    right: 12px;
    z-index: 999;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    padding: 9px 12px;
    border-radius: var(--cpp-radius-sm);
    font-size: 11px;
    line-height: 1.45;
    cursor: pointer;
    box-shadow: var(--cpp-glass-shadow);
    /* 浮层材质：toast 是压在内容之上的，用 surface 会透出底下的正文 */
    background: var(--cpp-glass-bg);
    backdrop-filter: var(--cpp-glass-blur);
    border: 1px solid var(--cpp-glass-border);
    border-left: 3px solid var(--cpp-accent);
    color: var(--cpp-text);
    animation: toast-in 0.18s ease-out;
  }
  /* 语义色**叠在**玻璃底之上，而不是替换掉它 —— 替换的话 toast 又变回透明的了。
     两层背景：渐变层给出色调，最后一层是玻璃底。 */
  .toast-error {
    border-left-color: var(--cpp-danger);
    background: linear-gradient(var(--cpp-danger-soft), var(--cpp-danger-soft)) var(--cpp-glass-bg);
  }
  .toast-warn {
    border-left-color: var(--cpp-warn);
    background: linear-gradient(var(--cpp-warn-soft), var(--cpp-warn-soft)) var(--cpp-glass-bg);
  }
  .toast-info { border-left-color: var(--cpp-accent); }
  .toast-enter { animation: toast-in 0.2s ease-out; }
  .toast-leave { animation: toast-out 0.15s ease-in; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes toast-out { from { opacity: 1; } to { opacity: 0; transform: translateY(8px); } }

  /* ── 弹窗 ─────────────────────────────────────────────── */
  /*
    遮罩用纯黑压暗，而不是叠 --cpp-ink：ink 是前景色，深色主题下接近白，
    拿它当遮罩等于给背景打上一层白雾，越"模糊"越糊。
    遮罩上不加 backdrop-filter —— 底下已经压到 42% 亮度，再模糊只会让
    弹窗边缘糊成一片，反而显得脏。
  */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--cpp-modal-scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  /*
    弹窗本体必须不透明：它盖在表单上面，半透明会让底下的字段名透上来和
    弹窗文字叠成两层，读不清也显得脏。这里用主题的控件底色（见令牌注释）。
  */
  .modal-dialog {
    background: var(--cpp-modal-bg);
    border: 1px solid var(--cpp-modal-border);
    border-radius: var(--cpp-radius);
    width: 100%;
    max-width: 440px;
    max-height: 85vh;
    overflow: visible;
    box-shadow: var(--cpp-modal-shadow);
    /* 不透明底 + 圆角：内容滚动时不会从圆角外溢出 */
    isolation: isolate;
  }
  .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--cpp-border); }
  .modal-title { font-size: 13px; font-weight: 700; }
  .modal-close { background: transparent; border: none; color: var(--cpp-text-dim); font-size: 18px; cursor: pointer; min-width: auto; padding: 0 4px; line-height: 1; }
  .modal-close:hover:not(:disabled) { background: transparent; color: var(--cpp-text); }
  .modal-body { padding: 8px 14px 14px; }

  /* ── Web Tools 弹窗 ───────────────────────────────────── */
  .search-btn { font-size: 10px; padding: 4px 9px; }
  .wt-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--cpp-border); margin-bottom: 8px; }
  .wt-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--cpp-text-dim);
    padding: 7px 0;
    font-size: 12px;
    cursor: pointer;
    min-width: auto;
    border-radius: 0;
    font-weight: 600;
  }
  .wt-tab.active { color: var(--cpp-accent); border-bottom-color: var(--cpp-accent); }
  .wt-tab:hover:not(:disabled) { background: transparent; color: var(--cpp-text); }

  .search-providers { display: flex; flex-direction: column; gap: 0; }
  .search-provider-card { border-bottom: 1px solid var(--cpp-border); padding: 9px 0; }
  .search-provider-card:last-of-type { border-bottom: none; }
  .search-provider-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .search-provider-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .search-provider-name { font-size: 12px; font-weight: 600; }
  .search-provider-hint { font-size: 10px; color: var(--cpp-text-faint); }
  .search-provider-key { margin-top: 6px; }
  .search-provider-key input { width: 100%; font-size: 11px; padding: 5px 8px; }
  .search-provider-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  .search-test-btn {
    font-size: 10px;
    padding: 3px 8px;
    cursor: pointer;
    background: var(--cpp-surface);
    color: var(--cpp-text);
    border: 1px solid var(--cpp-border-strong);
    border-radius: var(--cpp-radius-sm);
  }
  .search-test-btn:hover:not(:disabled) { background: var(--cpp-surface-2); }
  .search-test-btn:disabled { opacity: 0.5; cursor: default; }
  .search-test-result { font-size: 10px; line-height: 1.4; word-break: break-word; color: var(--cpp-text-dim); }
  .search-test-result.level-ok { color: var(--cpp-ok); }
  .search-test-result.level-error { color: var(--cpp-danger); }
  .search-options { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--cpp-border); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .search-max-results { display: flex; align-items: center; gap: 4px; font-size: 11px; }
  .search-max-results select { font-size: 11px; padding: 3px 5px; width: auto; }
  .search-dialog-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--cpp-border); }

  .fetch-providers { display: flex; flex-direction: column; gap: 0; }
  .fetch-provider-card { border-bottom: 1px solid var(--cpp-border); padding: 7px 0; }
  .fetch-provider-card:last-of-type { border-bottom: none; }
  .fetch-provider-row {
    display: flex !important;
    width: 100%;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    margin: 0 !important;
    text-transform: none !important;
    opacity: 1 !important;
    letter-spacing: normal !important;
    font-size: 12px !important;
    justify-content: flex-start;
    color: var(--cpp-text);
  }
  .fetch-provider-row .search-provider-name { white-space: nowrap; }
  .fetch-provider-hint { font-size: 10px; color: var(--cpp-text-faint); padding-left: 20px; margin-top: 1px; }
  .fetch-provider-row input[type=radio] { flex-shrink: 0; margin: 0; width: auto; background: none; border: none; padding: 0; }
  .fetch-provider-reuse { padding-left: 20px; margin-top: 6px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .fetch-provider-reuse-status { font-size: 10px; line-height: 1.4; word-break: break-word; color: var(--cpp-text-dim); }
  .fetch-provider-reuse-status.level-ok { color: var(--cpp-ok); }
  .fetch-provider-reuse-status.level-warn { color: var(--cpp-warn); }
  .fetch-provider-goto-search { font-size: 10px; padding: 3px 7px; cursor: pointer; }

  /* ── 确认弹窗 ─────────────────────────────────────────── */
  /*
    删除是不可逆动作，视觉上必须和普通按钮拉开差距：危险按钮用实心底，
    并且默认聚焦在它上面（键盘回车即确认，但 Esc / 点遮罩可退）。
  */
  .confirm-dialog { max-width: 340px; }
  .confirm-message { margin: 0; font-size: 11px; line-height: 1.55; color: var(--cpp-text); overflow-wrap: anywhere; }
  .confirm-warning {
    margin: 8px 0 0;
    padding: 6px 8px;
    font-size: 10px;
    line-height: 1.5;
    border-radius: var(--cpp-radius-sm);
    background: var(--cpp-warn-soft);
    border: 1px solid var(--cpp-warn-border);
    color: var(--cpp-warn);
  }
  .confirm-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px; }
  button.danger-solid { background: var(--cpp-danger); color: #fff; border-color: transparent; }
  button.danger-solid:hover:not(:disabled) { background: var(--cpp-danger); opacity: 0.88; }

  /* ── 用量 / 缓存仪表盘 ─────────────────────────────────── */
  .usage-body { display: flex; flex-direction: column; gap: 10px; }
  .usage-empty {
    font-size: 10px;
    line-height: 1.6;
    color: var(--cpp-text-dim);
    padding: 10px;
    background: var(--cpp-surface-2);
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius-sm);
  }
  .usage-empty code {
    font-family: var(--cpp-mono);
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--cpp-surface-3);
    color: var(--cpp-text);
    overflow-wrap: anywhere;
  }

  .usage-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--cpp-text-faint);
  }

  /*
    口径块：今日 / 全部累计。
    上下排开而不是并排 —— 两个块回答的是不同问题（"今天有没有白花" vs
    "总体上省了多少"），时间尺度也不同，并排会诱使人横向比较，而那个比较
    没有意义。上下排开各自成块，读的时候就不会串。
  */
  .usage-scopes { display: flex; flex-direction: column; gap: 10px; }
  .usage-scope { display: flex; flex-direction: column; gap: 6px; }
  /*
    块的标题条：左侧是口径名，右侧是这段时间的起止。
    只给左侧加一道强调色竖线 —— 两个块结构完全相同，没有这个记号的话
    视线容易把"全部累计"的数字当成"今日"的。
  */
  .usage-scope-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding-left: 7px;
    border-left: 2px solid var(--cpp-accent);
  }
  .usage-scope-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--cpp-text);
  }
  .usage-scope-range { font-size: 9px; font-family: var(--cpp-mono); color: var(--cpp-text-faint); }

  /*
    指标网格：6 等分，小卡片各占 2 份（一行三块），主指标占满一行。
    用 6 等分而不是 3 等分，是为了让主指标能跨满整行、小卡片又能三等分 ——
    3 等分做不到"一行三块 + 整行通栏"两种跨度并存。
  */
  .usage-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
  .usage-metric {
    grid-column: span 2;
    min-width: 0;
    padding: 8px 9px;
    border-radius: var(--cpp-radius-sm);
    background: var(--cpp-surface);
    border: 1px solid var(--cpp-border);
  }
  /* 命中率是这张面板的主指标，占满整行、字号也大一档 */
  .usage-metric-hero { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 1px; }
  .usage-value {
    margin-top: 3px;
    font-family: var(--cpp-mono);
    font-size: 16px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--cpp-text);
    overflow-wrap: anywhere;
  }
  .usage-metric-hero .usage-value { font-size: 26px; }
  .usage-sub { margin-top: 1px; font-size: 9px; font-family: var(--cpp-mono); color: var(--cpp-text-faint); overflow-wrap: anywhere; }

  /* 命中率配色：>=60% 正常，>=20% 偏低，<20% 基本等于没生效 */
  .tone-ok { color: var(--cpp-ok); }
  .tone-warn { color: var(--cpp-warn); }
  .tone-bad { color: var(--cpp-danger); }
  .tone-flat { color: var(--cpp-text-dim); }

  .usage-chart-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .usage-legend { display: flex; align-items: center; gap: 4px; font-size: 9px; color: var(--cpp-text-faint); }
  .usage-swatch { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }
  .usage-swatch-cached { background: var(--cpp-accent); }
  .usage-swatch-new { background: var(--cpp-surface-3); border: 1px solid var(--cpp-border-strong); }

  /*
    柱状图：定高容器 + 百分比高度。
    align-items:flex-end 让柱子从底部生长，配合 grid 等分 14 列。
    每根柱子内部再套一个 cached 层，用 bottom 对齐形成堆叠效果。
  */
  .usage-chart {
    position: relative;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 2px;
    align-items: end;
    height: 64px;
    padding: 4px;
    background: var(--cpp-surface-2);
    border: 1px solid var(--cpp-border);
    border-radius: var(--cpp-radius-sm);
  }
  .usage-slot { position: relative; height: 100%; display: flex; align-items: flex-end; min-width: 0; }
  .usage-col {
    position: relative;
    width: 100%;
    min-height: 2px;
    border-radius: 2px;
    background: var(--cpp-surface-3);
    border: 1px solid var(--cpp-border-strong);
    overflow: hidden;
  }
  .usage-col-cached {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--cpp-accent);
  }
  /* 整列都参与命中，柱本身窄，1px 的边框会显得柱子很虚 */
  .usage-slot:hover .usage-col { border-color: var(--cpp-accent); }
  .usage-slot:hover .usage-col-cached { background: var(--cpp-accent-hover); }
  .usage-axis { font-size: 9px; font-family: var(--cpp-mono); color: var(--cpp-text-faint); text-align: center; }

  /*
    悬浮详情 —— 不用原生 title。
    原生 tooltip 由操作系统绘制，延迟约 1s、无法做动画，在 14 根柱子之间横向
    对比时"等它弹出来"很拖沓；而且它不跟随柱子的位置，读数时要来回找。
    这里自己做一层：位置按列索引算，首尾两列夹在容器内不会溢出面板。
    显隐用 opacity + transform 而不是 display，否则过渡不会触发。
  */
  .usage-tip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    z-index: 30;
    min-width: 140px;
    padding: 6px 8px;
    border-radius: var(--cpp-radius-sm);
    /*
      底色必须不透明 —— 这是浮在图表/指标卡之上的读数面板，用 surface（4~11% 墨水）
      当底会直接把底下的数字透上来叠字。走 --cpp-hover-* 那条链：优先取宿主的
      editorHoverWidget 色，取不到就退到 editorWidget（控件底色），两者都是实色。
    */
    background: var(--cpp-hover-bg);
    border: 1px solid var(--cpp-hover-border);
    color: var(--cpp-hover-fg);
    box-shadow: var(--cpp-shadow-lg);
    font-size: 10px;
    line-height: 1.5;
    pointer-events: none;
    opacity: 0;
    transform: translateX(-50%) translateY(4px) scale(0.97);
    transition: opacity 0.12s ease, transform 0.12s ease;
  }
  .usage-tip.is-open { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  .usage-tip-date {
    font-family: var(--cpp-mono);
    font-weight: 700;
    margin-bottom: 3px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--cpp-border);
  }
  .usage-tip-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .usage-tip-label { color: var(--cpp-text-faint); }
  .usage-tip-value { font-family: var(--cpp-mono); font-weight: 600; }

  .usage-table-head { display: flex; align-items: center; justify-content: space-between; }
  .usage-table { display: flex; flex-direction: column; gap: 3px; }
  .usage-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--cpp-radius-sm);
    background: var(--cpp-surface-2);
    border: 1px solid var(--cpp-border);
  }
  .usage-row-name { min-width: 0; display: flex; flex-direction: column; }
  .usage-row-model { font-size: 10px; font-family: var(--cpp-mono); color: var(--cpp-text); overflow-wrap: anywhere; }
  .usage-row-provider { font-size: 9px; color: var(--cpp-text-faint); overflow-wrap: anywhere; }
  .usage-row-rate { font-size: 11px; font-weight: 700; font-family: var(--cpp-mono); }
  .usage-row-calls { font-size: 9px; font-family: var(--cpp-mono); color: var(--cpp-text-faint); }
`
