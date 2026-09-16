import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const DESCRIPTION = `Record a concise (6 words or less), user-friendly update of the major step or phase you are working on for the parent timeline. Update when the subtask changes. Set \`final_summary\` and \`completed_subtitle\` ONCE per response as your last action before the final response. ALWAYS use in parallel with at least one other tool. ALWAYS start the update with a descriptive verb.`

const ANTHROPIC = {
  name: 'updateCurrentStep',
  description: DESCRIPTION,
  inputSchema: {
    type: 'object',
    required: ['current_step'],
    properties: {
      current_step: {
        type: 'string',
        description: 'Major step or phase you are on. Update when the subtask changes. Keep the text concise, high-level, and user-friendly.',
        minLength: 1,
      },
      final_summary: {
        type: 'string',
        description: 'Include a BRIEF, 1-2 sentence, past-tense summary of the work you have done. No details, just a quick description of completed work and (only if applicable) work remaining from the user\'s original request. Set this field just ONCE per turn, as the last thing you do before your final response, at the same time that you set the completed_subtitle field.',
        minLength: 1,
      },
      completed_subtitle: {
        type: 'string',
        description: '4-6 word, past-tense, final summary of the work you have completed. Will be used as your agent subtitle in the UI. Keep the text concise, high-level, and user-friendly. Set this field ONCE per turn, as the last thing you do before your final response, at the same time that you set the final_summary field.',
        minLength: 1,
      },
    },
  },
}

const OPENAI = {
  name: 'updateCurrentStep',
  description: DESCRIPTION,
  inputSchema: {
    type: 'object',
    required: ['current_step'],
    properties: {
      current_step: {
        type: 'string',
        description: 'Major step or phase you are on. Update when the subtask changes. Keep the text concise, high-level, and user-friendly.',
      },
      final_summary: {
        type: 'string',
        description: 'Include a BRIEF, 1-2 sentence, past-tense summary of the work you have done. Set this field just ONCE per turn, as the last thing you do before your final response.',
      },
      completed_subtitle: {
        type: 'string',
        description: '4-6 word, past-tense, final summary of the work you have completed. Set this field ONCE per turn, as the last thing you do before your final response.',
      },
    },
  },
}

const GEMINI = {
  name: 'updateCurrentStep',
  description: DESCRIPTION,
  inputSchema: {
    type: 'OBJECT',
    required: ['current_step'],
    properties: {
      current_step: {
        type: 'STRING',
        description: 'Major step or phase you are on. Update when the subtask changes. Keep the text concise, high-level, and user-friendly.',
        minLength: 1,
      },
      final_summary: {
        type: 'STRING',
        description: 'Include a BRIEF, 1-2 sentence, past-tense summary of the work you have done. Set this field just ONCE per turn, as the last thing you do before your final response.',
        minLength: 1,
      },
      completed_subtitle: {
        type: 'STRING',
        description: '4-6 word, past-tense, final summary of the work you have completed. Set this field ONCE per turn, as the last thing you do before your final response.',
        minLength: 1,
      },
    },
  },
}

export const UpdateCurrentStepTool: ToolRegistryEntry = {
  canonicalName: 'updateCurrentStep',
  aliases: ['updateCurrentStep'],
  cursorToolType: 'communicateUpdateToolCall',
  execArgsType: null,
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    currentStep: str(input.current_step),
    ...(typeof input.final_summary === 'string' ? { finalSummary: input.final_summary } : {}),
    ...(typeof input.completed_subtitle === 'string' ? { completedSubtitle: input.completed_subtitle } : {}),
  }),
}
