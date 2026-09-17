import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'Glob',
  description: `Tool to search for files matching a glob pattern

- Works fast with codebases of any size
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches that are potentially useful as a batch.`,
  inputSchema: {
    type: 'object',
    required: [
      'glob_pattern',
    ],
    properties: {
      glob_pattern: {
        type: 'string',
        description: 'The glob pattern to match files against.\nPatterns not starting with "**/" are automatically prepended with "**/" to enable recursive searching.\n\nExamples:\n\t- "*.js" (becomes "**/*.js") - find all .js files\n\t- "**/node_modules/**" - find all node_modules directories\n\t- "**/test/**/test_*.ts" - find all test_*.ts files in any test directory',
      },
      target_directory: {
        type: 'string',
        description: 'Absolute path to directory to search for files in. If not provided, defaults to Cursor workspace root.',
      },
    },
  },
}

const OPENAI = {
  name: 'Glob',
  description: `Tool to search for files matching a glob pattern

- Works fast with codebases of any size
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches that are potentially useful as a batch.`,
  inputSchema: {
    type: 'object',
    properties: {
      target_directory: {
        type: 'string',
        description: 'Absolute path to directory to search for files in. If not provided, defaults to Cursor workspace root.',
      },
      glob_pattern: {
        type: 'string',
        description: 'The glob pattern to match files against.\nPatterns not starting with "**/" are automatically prepended with "**/" to enable recursive searching.\n\nExamples:\n- "*.js" (becomes "**/*.js") - find all .js files\n- "**/node_modules/**" - find all node_modules directories\n- "**/test/**/test_*.ts" - find all test_*.ts files in any test directory',
      },
    },
    required: [
      'glob_pattern',
    ],
  },
}

const GEMINI = {
  name: 'Glob',
  description: `
Tool to search for files matching a glob pattern

- Works fast with codebases of any size
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches that are potentially useful as a batch.
`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      glob_pattern: {
        type: 'STRING',
        description: 'The glob pattern to match files against.\nPatterns not starting with "**/" are automatically prepended with "**/" to enable recursive searching.\n\nExamples:\n\t- "*.js" (becomes "**/*.js") - find all .js files\n\t- "**/node_modules/**" - find all node_modules directories\n\t- "**/test/**/test_*.ts" - find all test_*.ts files in any test directory',
      },
      target_directory: {
        type: 'STRING',
        description: 'Absolute path to directory to search for files in. If not provided, defaults to Cursor workspace root.',
      },
    },
    required: [
      'glob_pattern',
    ],
  },
}

export const GlobTool: ToolRegistryEntry = {
  canonicalName: 'Glob',
  aliases: ['Glob'],
  cursorToolType: 'globToolCall',
  execArgsType: 'grepArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    targetDirectory: str(input.target_directory ?? input.targetDirectory ?? input.path),
    globPattern: str(input.glob_pattern ?? input.globPattern ?? input.pattern),
  }),
  buildExecArgs: (input, callId) => ({
    path: input.target_directory || input.targetDirectory || input.path || '',
    glob: input.glob_pattern || input.globPattern || input.pattern || '',
    outputMode: 'files_with_matches',
    toolCallId: callId,
    pattern: '',
  }),
}
