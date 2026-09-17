import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'SwitchMode',
  description: `Switch the interaction mode to better match the current task. Each mode is optimized for a specific type of work.

## When to Switch Modes

Switch modes proactively when:
1. **Task type changes** - User shifts from asking questions to requesting implementation, or vice versa
2. **Complexity emerges** - What seemed simple reveals architectural decisions or multiple approaches
3. **Debugging needed** - An error, bug, or unexpected behavior requires investigation
4. **Planning needed** - The task is large, ambiguous, or has significant trade-offs to discuss
5. **You're stuck** - Multiple attempts without progress suggest a different approach is needed

## When NOT to Switch

Do NOT switch modes for:
- Simple, clear tasks that can be completed quickly in current mode
- Mid-implementation when you're making good progress
- Minor clarifying questions (just ask them)
- Tasks where the current mode is working well

## Available Modes

### Agent Mode [switchable]
Default implementation mode with full access to all tools for making changes.

**Switch to Agent when:**
- You have a clear understanding of what to implement
- Planning/debugging is complete and you're ready to code
- The task is straightforward with an obvious implementation
- You've gathered enough context and are ready to execute

**Examples:**
- After planning: "I've designed the approach, ready to implement" → Switch to Agent
- After debugging: "Found the bug, it's a null check issue" → Switch to Agent
- Simple task: User asks to "Add a comment to this function" → Stay in Agent (no switch needed)

### Plan Mode [switchable]
Read-only collaborative mode for designing implementation approaches before coding.

**Switch to Plan when:**
- The task has multiple valid approaches with significant trade-offs
- Architectural decisions are needed (e.g., "Add caching" - Redis vs in-memory vs file-based)
- The task touches many files or systems (large refactors, migrations)
- Requirements are unclear and you need to explore before understanding scope
- You would otherwise ask multiple clarifying questions

**Examples:**
- User: "Add user authentication" → Switch to Plan (session vs JWT, storage, middleware decisions)
- User: "Refactor the database layer" → Switch to Plan (large scope, architectural impact)
- User: "Make the app faster" → Switch to Plan (need to profile, multiple optimization strategies)

### Debug Mode (cannot switch to this mode)
Systematic troubleshooting mode for investigating bugs, failures, and unexpected behavior with runtime evidence.

### Ask Mode (cannot switch to this mode)
Read-only mode for exploring code and answering questions without making changes.

## Important Notes

- **Be proactive**: Don't wait for the user to ask you to switch modes
- **Explain briefly**: When switching, briefly explain why in your \`explanation\` parameter
- **Don't over-switch**: If the current mode is working, stay in it
- **User approval required**: Mode switches require user consent`,
  inputSchema: {
    type: 'object',
    required: [
      'target_mode_id',
    ],
    properties: {
      target_mode_id: {
        type: 'string',
        enum: [
          'plan',
          'agent',
        ],
        description: 'The mode to switch to. Allowed values: \'plan\', \'agent\'.',
      },
      explanation: {
        type: 'string',
        description: 'Optional explanation for why the mode switch is requested. This helps the user understand why you\'re switching modes.',
      },
    },
  },
}

const OPENAI = {
  name: 'SwitchMode',
  description: `Switch the interaction mode to better match the current task. Each mode is optimized for a specific type of work.

## When to Switch Modes

Switch modes proactively when:
1. **Task type changes** - User shifts from asking questions to requesting implementation, or vice versa
2. **Complexity emerges** - What seemed simple reveals architectural decisions or multiple approaches
3. **Debugging needed** - An error, bug, or unexpected behavior requires investigation
4. **Planning needed** - The task is large, ambiguous, or has significant trade-offs to discuss
5. **You're stuck** - Multiple attempts without progress suggest a different approach is needed

## When NOT to Switch

Do NOT switch modes for:
- Simple, clear tasks that can be completed quickly in current mode
- Mid-implementation when you're making good progress
- Minor clarifying questions (just ask them)
- Tasks where the current mode is working well

## Available Modes

### Agent Mode [switchable]
Default implementation mode with full access to all tools for making changes.

**Switch to Agent when:**
- You have a clear understanding of what to implement
- Planning/debugging is complete and you're ready to code
- The task is straightforward with an obvious implementation
- You've gathered enough context and are ready to execute

**Examples:**
- After planning: "I've designed the approach, ready to implement" → Switch to Agent
- After debugging: "Found the bug, it's a null check issue" → Switch to Agent
- Simple task: User asks to "Add a comment to this function" → Stay in Agent (no switch needed)

### Plan Mode [switchable]
Read-only collaborative mode for designing implementation approaches before coding.

**Switch to Plan when:**
- The task has multiple valid approaches with significant trade-offs
- Architectural decisions are needed (e.g., "Add caching" - Redis vs in-memory vs file-based)
- The task touches many files or systems (large refactors, migrations)
- Requirements are unclear and you need to explore before understanding scope
- You would otherwise ask multiple clarifying questions

**Examples:**
- User: "Add user authentication" → Switch to Plan (session vs JWT, storage, middleware decisions)
- User: "Refactor the database layer" → Switch to Plan (large scope, architectural impact)
- User: "Make the app faster" → Switch to Plan (need to profile, multiple optimization strategies)

### Debug Mode (cannot switch to this mode)
Systematic troubleshooting mode for investigating bugs, failures, and unexpected behavior with runtime evidence.

### Ask Mode (cannot switch to this mode)
Read-only mode for exploring code and answering questions without making changes.

## Important Notes

- **Be proactive**: Don't wait for the user to ask you to switch
- **Explain briefly**: When switching, briefly explain why in your \`explanation\` parameter
- **Don't over-switch**: If the current mode is working, stay in it
- **User approval required**: Mode switches require user consent`,
  inputSchema: {
    type: 'object',
    properties: {
      target_mode_id: {
        type: 'string',
        description: 'The mode to switch to. Allowed values: \'plan\', \'agent\'.',
        enum: [
          'plan',
          'agent',
        ],
      },
      explanation: {
        type: 'string',
        description: 'Optional explanation for why the mode switch is requested. This helps the user understand why you\'re switching modes.',
      },
    },
    required: [
      'target_mode_id',
    ],
  },
}

const GEMINI = {
  name: 'SwitchMode',
  description: `Switch the interaction mode to better match the current task. Each mode is optimized for a specific type of work.

## When to Switch Modes

Switch modes proactively when:
1. **Task type changes** - User shifts from asking questions to requesting implementation, or vice versa
2. **Complexity emerges** - What seemed simple reveals architectural decisions or multiple approaches
3. **Debugging needed** - An error, bug, or unexpected behavior requires investigation
4. **Planning needed** - The task is large, ambiguous, or has significant trade-offs to discuss
5. **You're stuck** - Multiple attempts without progress suggest a different approach is needed

## When NOT to Switch

Do NOT switch modes for:
- Simple, clear tasks that can be completed quickly in current mode
- Mid-implementation when you're making good progress
- Minor clarifying questions (just ask them)
- Tasks where the current mode is working well

## Available Modes

### Agent Mode [switchable]
Default implementation mode with full access to all tools for making changes.

**Switch to Agent when:**
- You have a clear understanding of what to implement
- Planning/debugging is complete and you're ready to code
- The task is straightforward with an obvious implementation
- You've gathered enough context and are ready to execute

**Examples:**
- After planning: "I've designed the approach, ready to implement" → Switch to Agent
- After debugging: "Found the bug, it's a null check issue" → Switch to Agent
- Simple task: User asks to "Add a comment to this function" → Stay in Agent (no switch needed)

### Plan Mode [switchable]
Read-only collaborative mode for designing implementation approaches before coding.

**Switch to Plan when:**
- The task has multiple valid approaches with significant trade-offs
- Architectural decisions are needed (e.g., "Add caching" - Redis vs in-memory vs file-based)
- The task touches many files or systems (large refactors, migrations)
- Requirements are unclear and you need to explore before understanding scope
- You would otherwise ask multiple clarifying questions

**Examples:**
- User: "Add user authentication" → Switch to Plan (session vs JWT, storage, middleware decisions)
- User: "Refactor the database layer" → Switch to Plan (large scope, architectural impact)
- User: "Make the app faster" → Switch to Plan (need to profile, multiple optimization strategies)

### Debug Mode (cannot switch to this mode)
Systematic troubleshooting mode for investigating bugs, failures, and unexpected behavior with runtime evidence.

### Ask Mode (cannot switch to this mode)
Read-only mode for exploring code and answering questions without making changes.

## Important Notes

- **Be proactive**: Don't wait for the user to ask you to switch modes
- **Explain briefly**: When switching, briefly explain why in your \`explanation\` parameter
- **Don't over-switch**: If the current mode is working, stay in it
- **User approval required**: Mode switches require user consent`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      explanation: {
        type: 'STRING',
        description: 'Optional explanation for why the mode switch is requested. This helps the user understand why you\'re switching modes.',
      },
      target_mode_id: {
        type: 'STRING',
        description: 'The mode to switch to. Allowed values: \'plan\', \'agent\'.',
      },
    },
    required: [
      'target_mode_id',
    ],
  },
}

export const SwitchModeTool: ToolRegistryEntry = {
  canonicalName: 'SwitchMode',
  aliases: ['SwitchMode'],
  cursorToolType: 'switchModeToolCall',
  execArgsType: null,
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: (input, callId) => ({
    targetModeId: str(input.target_mode_id),
    ...(typeof input.explanation === 'string' ? { explanation: input.explanation } : {}),
    toolCallId: callId,
  }),
}
