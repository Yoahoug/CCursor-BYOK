import type { ToolRegistryEntry } from '../types'
import { arr } from '../shared'

const ANTHROPIC = {
  name: 'ReadLints',
  description: `Read and display linter errors from the current workspace. You can provide paths to specific files or directories, or omit the argument to get diagnostics for all files.

- If a file path is provided, returns diagnostics for that file only
- If a directory path is provided, returns diagnostics for all files within that directory
- If no path is provided, returns diagnostics for all files in the workspace
- This tool can return linter errors that were already present before your edits, so avoid calling it with a very wide scope of files
- NEVER call this tool on a file unless you've edited it or are about to edit it`,
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        description: 'Optional. An array of paths to files or directories to read linter errors for. You can use either relative paths in the workspace or absolute paths. If provided, returns diagnostics for the specified files/directories only. If not provided, returns diagnostics for all files in the workspace.',
        items: {
          type: 'string',
        },
      },
    },
  },
}

const OPENAI = {
  name: 'ReadLints',
  description: `Read linter warnings/errors. Only includes IDE diagnostics, which can occasionally be outdated. Optional paths array limits scope. Skip for unchanged files and ignore issues that existed before your changes.`,
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        description: 'Optional. An array of paths to files or directories to read linter errors for. You can use either relative paths in the workspace or absolute paths. If provided, returns diagnostics for the specified files/directories only. If not provided, returns diagnostics for all files in the workspace.',
        items: {
          type: 'string',
        },
      },
    },
  },
}

const GEMINI = {
  name: 'ReadLints',
  description: `Read and display linter errors from the current workspace. You can provide paths to specific files or directories, or omit the argument to get diagnostics for all files.

- If a file path is provided, returns diagnostics for that file only
- If a directory path is provided, returns diagnostics for all files within that directory
- If no path is provided, returns diagnostics for all files in the workspace
- This tool can return linter errors that were already present before your edits, so avoid calling it with a very wide scope of files
- NEVER call this tool on a file unless you've edited it or are about to edit it`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      paths: {
        type: 'ARRAY',
        description: 'Optional. An array of paths to files or directories to read linter errors for. You can use either relative paths in the workspace or absolute paths. If provided, returns diagnostics for the specified files/directories only. If not provided, returns diagnostics for all files in the workspace.',
        items: {
          type: 'STRING',
        },
      },
    },
  },
}

export const ReadLintsTool: ToolRegistryEntry = {
  canonicalName: 'ReadLints',
  aliases: ['ReadLints'],
  cursorToolType: 'readLintsToolCall',
  execArgsType: 'diagnosticsArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    paths: arr<string>(input.paths).map(v => String(v)),
  }),
  buildExecArgs: (input, callId) => {
    const paths = Array.isArray(input.paths) ? input.paths : []
    return { path: input.path || paths[0] || '', toolCallId: callId }
  },
}
