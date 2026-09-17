import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'Read',
  description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Lines in the output are numbered starting at 1, using following format: LINE_NUMBER|LINE_CONTENT
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive 'File is empty.'

Image Support:
- This tool can also read image files when called with the appropriate path.
- Supported image formats: jpeg/jpg, png, gif, webp.

PDF Support:
- PDF files are converted into text content automatically (subject to the same character limits as other files).`,
  inputSchema: {
    type: 'object',
    required: [
      'path',
    ],
    properties: {
      path: {
        type: 'string',
        description: 'The absolute path of the file to read.',
      },
      offset: {
        type: 'integer',
        description: 'The line number to start reading from. Positive values are 1-indexed from the start of the file. Negative values count backwards from the end (e.g. -1 is the last line). Only provide if the file is too large to read at once.',
      },
      limit: {
        type: 'integer',
        description: 'The number of lines to read. Only provide if the file is too large to read at once.',
      },
    },
  },
}

const OPENAI = {
  name: 'ReadFile',
  description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Lines in the output are numbered starting at 1, using following format: LINE_NUMBER|LINE_CONTENT
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive 'File is empty.'

Image Support:
- This tool can also read image files when called with the appropriate path.
- Supported image formats: jpeg/jpg, png, gif, webp.

PDF Support:
- PDF files are converted into text content automatically (subject to the same character limits as other files).`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The absolute path of the file to read.',
      },
      offset: {
        type: 'integer',
        description: 'The line number to start reading from. Positive values are 1-indexed from the start of the file. Negative values count backwards from the end (e.g. -1 is the last line). Only provide if the file is too large to read once.',
      },
      limit: {
        type: 'integer',
        description: 'The number of lines to read. Only provide if the file is too large to read once.',
      },
    },
    required: [
      'path',
    ],
  },
}

const GEMINI = {
  name: 'Read',
  description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Lines in the output are numbered starting at 1, using following format: LINE_NUMBER|LINE_CONTENT
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive 'File is empty.'

Image Support:
- This tool can also read image files when called with the appropriate path.
- Supported image formats: jpeg/jpg, png, gif, webp.

PDF Support:
- PDF files are converted into text content automatically (subject to the same character limits as other files).`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      limit: {
        type: 'INTEGER',
        description: 'The number of lines to read. Only provide if the file is too large to read at once.',
      },
      offset: {
        type: 'INTEGER',
        description: 'The line number to start reading from. Positive values are 1-indexed from the start of the file. Negative values count backwards from the end (e.g. -1 is the last line). Only provide if the file is too large to read at once.',
      },
      path: {
        type: 'STRING',
        description: 'The absolute path of the file to read.',
      },
    },
    required: [
      'path',
    ],
  },
}

export const ReadTool: ToolRegistryEntry = {
  canonicalName: 'Read',
  aliases: ['Read', 'ReadFile'],
  cursorToolType: 'readToolCall',
  execArgsType: 'readArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    path: str(input.path ?? input.file_path),
  }),
  buildExecArgs: (input, callId) => ({
    path: str(input.path ?? input.file_path),
    toolCallId: callId,
    ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
  }),
}
