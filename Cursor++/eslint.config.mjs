import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  ignores: [
    // 真正的生成物：140808 行由 protobuf 代码生成器产出，不参与人工维护。
    'src/server/gen/**',
    'dist/**',
    'out/**',
    'obfuscate.js',
    'esbuild.js',
    'package.json',
    'tsconfig.json',
  ],
}, {
  rules: {
    'no-console': 'off',
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'ts/no-require-imports': 'off',
  },
}, {
  // EditNotebook 的 description 是**逐字复制官方工具描述**的模板字符串，
  // 官方原文用行首 tab 表达层级（`\t- ...` / `\t\t-- ...`）。
  // 换成空格会改变发给模型的描述文本，因此保留 tab 并在此局部豁免。
  // 只豁免这一个文件，避免整目录排除再次掩盖真问题。
  files: ['src/server/handlers/agent/toolkit/definitions/EditNotebook.ts'],
  rules: {
    'style/no-tabs': 'off',
  },
})
