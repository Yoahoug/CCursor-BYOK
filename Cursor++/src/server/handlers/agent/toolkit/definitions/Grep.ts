import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'Grep',
  description: `A powerful search tool built on ripgrep
Usage:
- Prefer using Grep for search tasks when you know the exact symbols or strings to search for. Whenever possible, use this tool instead of invoking grep or rg as a terminal command. The Grep tool has been optimized for speed and file restrictions inside Cursor.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., ".js", "**/.tsx") or type parameter (e.g., "js", "py", "rust")
- Output modes: "content" shows matching lines (default), "files_with_matches" shows only file paths, "count" shows match counts
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use interface\\{\\} to find interface{} in Go code)
- Multiline matching: By default patterns match within single lines only. For cross-line patterns like struct \\{[\\s\\S]*?field, use multiline: true
- Results are capped to several thousand output lines for responsiveness; when truncation occurs, the results report "at least" counts, but are otherwise accurate.
- Content output formatting closely follows ripgrep output format: '-' for context lines, ':' for match lines, and all context/match lines below each file group.`,
  inputSchema: {
    type: 'object',
    required: [
      'pattern',
    ],
    properties: {
      'pattern': {
        type: 'string',
        description: 'The regular expression pattern to search for in file contents',
      },
      'path': {
        type: 'string',
        description: 'File or directory to search in (rg pattern -- PATH). Defaults to Cursor workspace root.',
      },
      'glob': {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
      },
      'type': {
        type: 'string',
        description: 'File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.',
      },
      'output_mode': {
        type: 'string',
        enum: [
          'content',
          'files_with_matches',
          'count',
        ],
        description: 'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "content".',
      },
      '-i': {
        type: 'boolean',
        description: 'Case insensitive search (rg -i) Defaults to false',
      },
      '-A': {
        type: 'number',
        description: 'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
      },
      '-B': {
        type: 'number',
        description: 'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
      },
      '-C': {
        type: 'number',
        description: 'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
      },
      'multiline': {
        type: 'boolean',
        description: 'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
      },
      'head_limit': {
        type: 'number',
        minimum: 0,
        description: 'Limit output size. For "content" mode: limits total matches shown. For "files_with_matches" and "count" modes: limits number of files.',
      },
      'offset': {
        type: 'number',
        minimum: 0,
        description: 'Skip first N entries. For "content" mode: skips first N matches. For "files_with_matches" and "count" modes: skips first N files. Use with head_limit for pagination.',
      },
    },
  },
}

const OPENAI = {
  name: 'rg',
  description: `Search the workspace with ripgrep.

- Use this tool instead of shell rg; respects .gitignore and .cursorignore
- Default scope is the workspace root; set path (absolute path) to narrow it
- Supply a regex pattern; escape metacharacters, e.g. "functionCall\\\\(", "\\\\{", "\\\\}"
- Prefer type over broad glob; wildcard globs like * bypass ignore rules and slow searches
- Enable multiline only when a match spans lines—it can degrade performance
- Context flags (-A, -B, -C) only affect content output
- If results show "at least …", the output was truncated; tighten the query or raise head_limit`,
  inputSchema: {
    type: 'object',
    properties: {
      'pattern': {
        type: 'string',
        description: 'The regular expression pattern to search for in file contents',
      },
      'path': {
        type: 'string',
        description: 'File or directory to search in (rg pattern -- PATH). Defaults to Cursor workspace root.',
      },
      'glob': {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
      },
      'output_mode': {
        type: 'string',
        description: 'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "content".',
        enum: [
          'content',
          'files_with_matches',
          'count',
        ],
      },
      '-B': {
        type: 'number',
        description: 'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
      },
      '-A': {
        type: 'number',
        description: 'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
      },
      '-C': {
        type: 'number',
        description: 'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
      },
      '-i': {
        type: 'boolean',
        description: 'Case insensitive search (rg -i) Defaults to false',
      },
      'type': {
        type: 'string',
        description: 'File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.',
      },
      'head_limit': {
        type: 'number',
        description: 'Limit output size. For "content" mode: limits total matches shown. For "files_with_matches" and "count" modes: limits number of files.',
        minimum: 0,
      },
      'offset': {
        type: 'number',
        description: 'Skip first N entries. For "content" mode: skips first N matches. For "files_with_matches" and "count" modes: skips first N files. Use with head_limit for pagination.',
        minimum: 0,
      },
      'multiline': {
        type: 'boolean',
        description: 'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
      },
    },
    required: [
      'pattern',
    ],
  },
}

const GEMINI = {
  name: 'Grep',
  description: `A powerful search tool built on ripgrep
Usage:
- Prefer using Grep for search tasks when you know the exact symbols or strings to search for. Whenever possible, use this tool instead of invoking grep or rg as a terminal command. The Grep tool has been optimized for speed and file restrictions inside Cursor.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., ".js", "**/.tsx") or type parameter (e.g., "js", "py", "rust")
- Output modes: "content" shows matching lines (default), "files_with_matches" shows only file paths, "count" shows match counts
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use interface\\{\\} to find interface{} in Go code)
- Multiline matching: By default patterns match within single lines only. For cross-line patterns like struct \\{[\\s\\S]*?field, use multiline: true
- Results are capped to several thousand output lines for responsiveness; when truncation occurs, the results report "at least" counts, but are otherwise accurate.
- Content output formatting closely follows ripgrep output format: '-' for context lines, ':' for match lines, and all context/match lines below each file group.`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      '-A': {
        type: 'NUMBER',
        description: 'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
      },
      '-B': {
        type: 'NUMBER',
        description: 'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
      },
      '-C': {
        type: 'NUMBER',
        description: 'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
      },
      '-i': {
        type: 'BOOLEAN',
        description: 'Case insensitive search (rg -i) Defaults to false',
      },
      'glob': {
        type: 'STRING',
        description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
      },
      'head_limit': {
        type: 'NUMBER',
        description: 'Limit output size. For "content" mode: limits total matches shown. For "files_with_matches" and "count" modes: limits number of files.',
      },
      'multiline': {
        type: 'BOOLEAN',
        description: 'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
      },
      'offset': {
        type: 'NUMBER',
        description: 'Skip first N entries. For "content" mode: skips first N matches. For "files_with_matches" and "count" modes: skips first N files. Use with head_limit for pagination.',
      },
      'output_mode': {
        type: 'STRING',
        enum: [
          'content',
          'files_with_matches',
          'count',
        ],
        description: 'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "content".',
      },
      'path': {
        type: 'STRING',
        description: 'File or directory to search in (rg pattern -- PATH). Defaults to Cursor workspace root.',
      },
      'pattern': {
        type: 'STRING',
        description: 'The regular expression pattern to search for in file contents',
      },
      'type': {
        type: 'STRING',
        description: 'File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.',
      },
    },
    required: [
      'pattern',
    ],
  },
}

export const GrepTool: ToolRegistryEntry = {
  canonicalName: 'Grep',
  aliases: ['Grep', 'rg'],
  cursorToolType: 'grepToolCall',
  execArgsType: 'grepArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: (input, callId) => ({
    pattern: str(input.pattern),
    ...(str(input.path) ? { path: str(input.path) } : {}),
    ...(typeof input.glob === 'string' ? { glob: input.glob } : {}),
    ...(typeof input.type === 'string' ? { type: input.type } : {}),
    ...(typeof input.output_mode === 'string' ? { outputMode: input.output_mode } : {}),
    ...(typeof input['-i'] === 'boolean' ? { caseInsensitive: input['-i'] } : {}),
    ...(typeof input['-A'] === 'number' ? { contextAfter: input['-A'] } : {}),
    ...(typeof input['-B'] === 'number' ? { contextBefore: input['-B'] } : {}),
    ...(typeof input['-C'] === 'number' ? { context: input['-C'] } : {}),
    ...(typeof input.multiline === 'boolean' ? { multiline: input.multiline } : {}),
    ...(typeof input.head_limit === 'number' ? { headLimit: input.head_limit } : {}),
    ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
    toolCallId: callId,
  }),
  buildExecArgs: (input, callId) => ({
    pattern: str(input.pattern),
    ...(str(input.path) ? { path: str(input.path) } : {}),
    ...(typeof input.glob === 'string' ? { glob: input.glob } : {}),
    ...(typeof input.type === 'string' ? { type: input.type } : {}),
    outputMode: typeof input.output_mode === 'string' ? input.output_mode : 'content',
    ...(typeof input['-i'] === 'boolean' ? { caseInsensitive: input['-i'] } : {}),
    ...(typeof input['-A'] === 'number' ? { contextAfter: input['-A'] } : {}),
    ...(typeof input['-B'] === 'number' ? { contextBefore: input['-B'] } : {}),
    ...(typeof input['-C'] === 'number' ? { context: input['-C'] } : {}),
    ...(typeof input.multiline === 'boolean' ? { multiline: input.multiline } : {}),
    ...(typeof input.head_limit === 'number' ? { headLimit: input.head_limit } : {}),
    ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
    toolCallId: callId,
  }),
}
