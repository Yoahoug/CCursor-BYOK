import type { ToolRegistryEntry } from '../types'
import { arr, str } from '../shared'

/**
 * CreatePlan — Plan Mode 专用工具
 *
 * Proto: createPlanToolCall (field 17)
 * Args: CreatePlanArgs { plan, todos[], overview, name, is_project?, phases[] }
 * Result: CreatePlanResult { plan_uri, oneof { success: {}, error: { error } } }
 *
 * 流程: 交互握手 (CreatePlanRequestQuery → CreatePlanRequestResponse)
 * 客户端创建 .plan.md 文件并返回 planUri。
 *
 * 此工具不暴露给 LLM（由系统在 Plan Mode 下自动注入），
 * 但需要注册以处理 LLM 主动调用 CreatePlan 的情况。
 */
const CREATE_PLAN_TOOL = {
  name: 'CreatePlan',
  description: `Use this tool to create a concise plan for accomplishing the user's request. This tool should be called at the end of the planning phase to finalize and store the plan.

The plan you create should be properly formatted in markdown, using appropriate sections and headers. The plan should be very concise and actionable, providing the minimum amount of detail for the user to understand and action the plan.`,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short 3-4 word name for the plan. IMPORTANT: This should only be provided on the FIRST CreatePlan call. On subsequent updates, this field will be ignored to keep the plan file name stable.' },
      overview: { type: 'string', description: 'A 1-2 sentence high-level description of the plan that summarizes what will be accomplished' },
      plan: { type: 'string', description: 'A detailed, concrete plan for accomplishing the user\'s request' },
      todos: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'content'],
          properties: {
            id: { type: 'string', description: 'Unique identifier for the todo' },
            content: { type: 'string', description: 'Description of the todo task' },
          },
        },
        description: 'Array of implementation todos',
      },
    },
  },
}

const GEMINI_CREATE_PLAN = {
  ...CREATE_PLAN_TOOL,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING', description: CREATE_PLAN_TOOL.inputSchema.properties.name.description },
      overview: { type: 'STRING', description: CREATE_PLAN_TOOL.inputSchema.properties.overview.description },
      plan: { type: 'STRING', description: CREATE_PLAN_TOOL.inputSchema.properties.plan.description },
      todos: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: ['id', 'content'],
          properties: {
            id: { type: 'STRING', description: 'Unique identifier for the todo' },
            content: { type: 'STRING', description: 'Description of the todo task' },
          },
        },
        description: 'Array of implementation todos',
      },
    },
  },
}

export const CreatePlanTool: ToolRegistryEntry = {
  canonicalName: 'CreatePlan',
  aliases: ['CreatePlan'],
  cursorToolType: 'createPlanToolCall',
  execArgsType: null,
  llmToolByProvider: {
    anthropic: CREATE_PLAN_TOOL,
    openai: CREATE_PLAN_TOOL,
    gemini: GEMINI_CREATE_PLAN,
  },
  buildStartedArgs: input => ({
    plan: str(input.plan),
    todos: arr<Record<string, unknown>>(input.todos),
    overview: str(input.overview),
    name: str(input.name),
    ...(typeof input.is_project === 'boolean' ? { isProject: input.is_project } : {}),
    ...(Array.isArray(input.phases) ? { phases: input.phases } : {}),
  }),
}
