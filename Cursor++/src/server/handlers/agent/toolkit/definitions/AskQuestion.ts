import type { ToolRegistryEntry } from '../types'
import { arr, bool, str } from '../shared'

const ANTHROPIC = {
  name: 'AskQuestion',
  description: `Collect structured multiple-choice answers from the user.
Provide one or more questions with options, and set allow_multiple when multi-select is appropriate.

Use this tool when you need to gather specific information from the user through a structured question format.
Each question should have:
- A unique id (used to match answers)
- A clear prompt/question text
- At least 2 options for the user to choose from
- An optional allow_multiple flag (defaults to false for single-select)
By default, the tool will present the questions to the user and wait for their responses before continuing.`,
  inputSchema: {
    type: 'object',
    required: [
      'questions',
    ],
    properties: {
      title: {
        type: 'string',
        description: 'Optional title for the questions form',
      },
      questions: {
        type: 'array',
        minItems: 1,
        description: 'Array of questions to present to the user (minimum 1 required)',
        items: {
          type: 'object',
          required: [
            'id',
            'prompt',
            'options',
          ],
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for this question',
            },
            prompt: {
              type: 'string',
              description: 'The question text to display to the user, without the options.',
            },
            options: {
              type: 'array',
              minItems: 2,
              description: 'Array of answer options (minimum 2 required)',
              items: {
                type: 'object',
                required: [
                  'id',
                  'label',
                ],
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier for this option',
                  },
                  label: {
                    type: 'string',
                    description: 'Display text for this option',
                  },
                },
              },
            },
            allow_multiple: {
              type: 'boolean',
              description: 'If true, user can select multiple options. Defaults to false.',
            },
          },
        },
      },
    },
  },
}

const OPENAI = {
  name: 'AskQuestion',
  description: `Collect structured multiple-choice answers from the user.
Provide one or more questions with options, and set allow_multiple when multi-select is appropriate.

Use this tool when you need to gather specific information from the user through a structured question format.
Each question should have:
- A unique id (used to match answers)
- A clear prompt/question text
- At least 2 options for the user to choose from
- An optional allow_multiple flag (defaults to false for single-select)
By default, the tool will present the questions to the user and wait for their responses before continuing.`,
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Optional title for the questions form',
      },
      questions: {
        type: 'array',
        description: 'Array of questions to present to the user (minimum 1 required)',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'A unique id (used to match answers)',
            },
            prompt: {
              type: 'string',
              description: 'The question text to display to the user, without the options.',
            },
            options: {
              type: 'array',
              description: 'Array of answer options (minimum 2 required)',
              minItems: 2,
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier for this option',
                  },
                  label: {
                    type: 'string',
                    description: 'Display text for this option',
                  },
                },
                required: [
                  'id',
                  'label',
                ],
              },
            },
            allow_multiple: {
              type: 'boolean',
              description: 'If true, user can select multiple options. Defaults to false.',
            },
          },
          required: [
            'id',
            'prompt',
            'options',
          ],
        },
      },
    },
    required: [
      'questions',
    ],
  },
}

const GEMINI = {
  name: 'AskQuestion',
  description: `Collect structured multiple-choice answers from the user.
Provide one or more questions with options, and set allow_multiple when multi-select is appropriate.

Use this tool when you need to gather specific information from the user through a structured question format.
Each question should have:
- A unique id (used to match answers)
- A clear prompt/question text
- At least 2 options for the user to choose from
- An optional allow_multiple flag (defaults to false for single-select)
By default, the tool will present the questions to the user and wait for their responses before continuing.`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY',
        description: 'Array of questions to present to the user (minimum 1 required)',
        items: {
          type: 'OBJECT',
          properties: {
            allow_multiple: {
              type: 'BOOLEAN',
              description: 'If true, user can select multiple options. Defaults to false.',
            },
            id: {
              type: 'STRING',
              description: 'Unique identifier for this question',
            },
            options: {
              type: 'ARRAY',
              description: 'Array of answer options (minimum 2 required)',
              items: {
                type: 'OBJECT',
                properties: {
                  id: {
                    type: 'STRING',
                    description: 'Unique identifier for this option',
                  },
                  label: {
                    type: 'STRING',
                    description: 'Display text for this option',
                  },
                },
                required: [
                  'id',
                  'label',
                ],
              },
            },
            prompt: {
              type: 'STRING',
              description: 'The question text to display to the user, without the options.',
            },
          },
          required: [
            'id',
            'prompt',
            'options',
          ],
        },
      },
      title: {
        type: 'STRING',
        description: 'Optional title for the questions form',
      },
    },
    required: [
      'questions',
    ],
  },
}

export const AskQuestionTool: ToolRegistryEntry = {
  canonicalName: 'AskQuestion',
  aliases: ['AskQuestion'],
  cursorToolType: 'askQuestionToolCall',
  execArgsType: null,
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    title: str(input.title),
    questions: arr<Record<string, unknown>>(input.questions).map(question => ({
      id: str(question.id),
      prompt: str(question.prompt),
      options: arr<Record<string, unknown>>(question.options).map(option => ({
        id: str(option.id),
        label: str(option.label),
      })),
      allowMultiple: bool(question.allow_multiple ?? question.allowMultiple),
    })),
    runAsync: bool(input.runAsync),
    asyncOriginalToolCallId: str(input.asyncOriginalToolCallId),
  }),
}
