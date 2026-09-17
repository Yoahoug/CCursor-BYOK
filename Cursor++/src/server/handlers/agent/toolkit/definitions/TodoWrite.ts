import type { ToolRegistryEntry } from '../types'
import { arr, bool } from '../shared'

const ANTHROPIC = {
  name: 'TodoWrite',
  description: `Use this tool to create and manage a structured task list for your current coding session. This helps track progress, organize complex tasks, and demonstrate thoroughness.

Note: Other than when first creating todos, don't tell the user you're updating todos, just do it.

### When to Use This Tool

Use proactively for:
1. Complex multi-step tasks (3+ distinct steps)
2. Non-trivial tasks requiring careful planning
3. User explicitly requests todo list
4. User provides multiple tasks (numbered/comma-separated)
5. After receiving new instructions - capture requirements as todos (use merge=false to add new ones)
6. After completing tasks - mark complete with merge=true and add follow-ups
7. When starting new tasks - mark as in_progress (ideally only one at a time)

### When NOT to Use

Skip for:
1. Single, straightforward tasks
2. Trivial tasks with no organizational benefit
3. Tasks completable in < 3 trivial steps
4. Purely conversational/informational requests
5. Don't add a task to test the change unless asked, or you'll overfocus on testing

### Examples

<example>
  User: Add dark mode toggle to settings
  Assistant:
    - *Creates todo list:*
      1. Add state management [in_progress]
      2. Implement styles
      3. Create toggle component
      4. Update components
    - [Immediately begins working on todo 1 in the same tool call batch]
<reasoning>
  Multi-step feature with dependencies.
</reasoning>
</example>

<example>
  User: Rename getCwd to getCurrentWorkingDirectory across my project
  Assistant: *Searches codebase, finds 15 instances across 8 files*
  *Creates todo list with specific items for each file that needs updating*

<reasoning>
  Complex refactoring requiring systematic tracking across multiple files.
</reasoning>
</example>

<example>
  User: Implement user registration, product catalog, shopping cart, checkout flow.
  Assistant: *Creates todo list breaking down each feature into specific tasks*

<reasoning>
  Multiple complex features provided as list requiring organized task management.
</reasoning>
</example>

<example>
  User: Optimize my React app - it's rendering slowly.
  Assistant: *Analyzes codebase, identifies issues*
  *Creates todo list: 1) Memoization, 2) Virtualization, 3) Image optimization, 4) Fix state loops, 5) Code splitting*

<reasoning>
  Performance optimization requires multiple steps across different components.
</reasoning>
</example>

### Examples of When NOT to Use the Todo List

<example>
  User: What does git status do?
  Assistant: Shows current state of working directory and staging area...

<reasoning>
  Informational request with no coding task to complete.
</reasoning>
</example>

<example>
  User: Add comment to calculateTotal function.
  Assistant: *Uses edit tool to add comment*

<reasoning>
  Single straightforward task in one location.
</reasoning>
</example>

<example>
  User: Run npm install for me.
  Assistant: *Executes npm install* Command completed successfully...

<reasoning>
  Single command execution with immediate results.
</reasoning>
</example>

### Task States and Management

1. **Task States:**
  - pending: Not yet started
  - in_progress: Currently working on
  - completed: Finished successfully
  - cancelled: No longer needed

2. **Task Management:**
  - Update status in real-time
  - Mark complete IMMEDIATELY after finishing
  - Only ONE task in_progress at a time
  - Complete current tasks before starting new ones

3. **Task Breakdown:**
  - Create specific, actionable items
  - Break complex tasks into manageable steps
  - Use clear, descriptive names

4. **Parallel Todo Writes:**
  - Prefer creating the first todo as in_progress
  - Start working on todos by using tool calls in the same tool call batch as the todo write
  - Batch todo updates with other tool calls for better latency and lower costs for the user

When in doubt, use this tool. Proactive task management demonstrates attentiveness and ensures complete requirements.`,
  inputSchema: {
    type: 'object',
    required: [
      'todos',
      'merge',
    ],
    properties: {
      todos: {
        type: 'array',
        minItems: 2,
        description: 'Array of TODO items to update or create',
        items: {
          type: 'object',
          required: [
            'id',
            'content',
            'status',
          ],
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for the TODO item',
            },
            content: {
              type: 'string',
              description: 'The description/content of the todo item',
            },
            status: {
              type: 'string',
              enum: [
                'pending',
                'in_progress',
                'completed',
                'cancelled',
              ],
              description: 'The current status of the TODO item',
            },
          },
        },
      },
      merge: {
        type: 'boolean',
        description: 'Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos.',
      },
    },
  },
}

const OPENAI = {
  name: 'TodoWrite',
  description: `Updates the todo list. Provide a list of todo items, each with an id, content, and status. Provide merge=true to update existing tasks.

### Guidelines
- At most one task can be in_progress at a time.
- Cancel tasks that are no longer needed immediately.
- Prefer creating the first todo as in_progress
- Batch todo updates with other tool calls in parallel`,
  inputSchema: {
    type: 'object',
    properties: {
      merge: {
        type: 'boolean',
        description: 'Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos.',
      },
      todos: {
        type: 'array',
        description: 'Array of TODO items to update or create',
        minItems: 2,
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for the TODO item',
            },
            content: {
              type: 'string',
              description: 'The description/content of the todo item',
            },
            status: {
              type: 'string',
              description: 'The current status of the TODO item',
              enum: [
                'pending',
                'in_progress',
                'completed',
                'cancelled',
              ],
            },
          },
          required: [
            'id',
            'content',
            'status',
          ],
        },
      },
    },
    required: [
      'merge',
      'todos',
    ],
  },
}

const GEMINI = {
  name: 'TodoWrite',
  description: `Use this tool to create and manage a structured task list for your current coding session. This helps track progress, organize complex tasks, and demonstrate thoroughness.

Note: Other than when first creating todos, don't tell the user you're updating todos, just do it.

### When to Use This Tool

Use proactively for:
1. Complex multi-step tasks (3+ distinct steps)
2. Non-trivial tasks requiring careful planning
3. User explicitly requests todo list
4. User provides multiple tasks (numbered/comma-separated)
5. After receiving new instructions - capture requirements as todos (use merge=false to add new ones)
6. After completing tasks - mark complete with merge=true and add follow-ups
7. When starting new tasks - mark as in_progress (ideally only one at a time)

### When NOT to Use

Skip for:
1. Single, straightforward tasks
2. Trivial tasks with no organizational benefit
3. Tasks completable in < 3 trivial steps
4. Purely conversational/informational requests
5. Don't add a task to test the change unless asked, or you'll overfocus on testing

### Examples

<example>
  User: Add dark mode toggle to settings
  Assistant:
    - *Creates todo list:*
      1. Add state management [in_progress]
      2. Implement styles
      3. Create toggle component
      4. Update components
    - [Immediately begins working on todo 1 in the same tool call batch]
<reasoning>
  Multi-step feature with dependencies.
</reasoning>
</example>

<example>
  User: Rename getCwd to getCurrentWorkingDirectory across my project
  Assistant: *Searches codebase, finds 15 instances across 8 files*
  *Creates todo list with specific items for each file that needs updating*

<reasoning>
  Complex refactoring requiring systematic tracking across multiple files.
</reasoning>
</example>

<example>
  User: Implement user registration, product catalog, shopping cart, checkout flow.
  Assistant: *Creates todo list breaking down each feature into specific tasks*

<reasoning>
  Multiple complex features provided as list requiring organized task management.
</reasoning>
</example>

<example>
  User: Optimize my React app - it's rendering slowly.
  Assistant: *Analyzes codebase, identifies issues*
  *Creates todo list: 1) Memoization, 2) Virtualization, 3) Image optimization, 4) Fix state loops, 5) Code splitting*

<reasoning>
  Performance optimization requires multiple steps across different components.
</reasoning>
</example>

### Examples of When NOT to Use the Todo List

<example>
  User: What does git status do?
  Assistant: Shows current state of working directory and staging area...

<reasoning>
  Informational request with no coding task to complete.
</reasoning>
</example>

<example>
  User: Add comment to calculateTotal function.
  Assistant: *Uses edit tool to add comment*

<reasoning>
  Single straightforward task in one location.
</reasoning>
</example>

<example>
  User: Run npm install for me.
  Assistant: *Executes npm install* Command completed successfully...

<reasoning>
  Single command execution with immediate results.
</reasoning>
</example>

### Task States and Management

1. **Task States:**
  - pending: Not yet started
  - in_progress: Currently working on
  - completed: Finished successfully
  - cancelled: No longer needed

2. **Task Management:**
  - Update status in real-time
  - Mark complete IMMEDIATELY after finishing
  - Only ONE task in_progress at a time
  - Complete current tasks before starting new ones

3. **Task Breakdown:**
  - Create specific, actionable items
  - Break complex tasks into manageable steps
  - Use clear, descriptive names

4. **Parallel Todo Writes:**
  - Prefer creating the first todo as in_progress
  - Start working on todos by using tool calls in the same tool call batch as the todo write
  - Batch todo updates with other tool calls for better latency and lower costs for the user

When in doubt, use this tool. Proactive task management demonstrates attentiveness and ensures complete requirements.`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      merge: {
        type: 'BOOLEAN',
        description: 'Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos.',
      },
      todos: {
        type: 'ARRAY',
        description: 'Array of TODO items to update or create',
        items: {
          type: 'OBJECT',
          properties: {
            content: {
              type: 'STRING',
              description: 'The description/content of the todo item',
            },
            id: {
              type: 'STRING',
              description: 'Unique identifier for the TODO item',
            },
            status: {
              type: 'STRING',
              enum: [
                'pending',
                'in_progress',
                'completed',
                'cancelled',
              ],
              description: 'The current status of the TODO item',
            },
          },
          required: [
            'id',
            'content',
            'status',
          ],
        },
      },
    },
    required: [
      'todos',
      'merge',
    ],
  },
}

export const TodoWriteTool: ToolRegistryEntry = {
  canonicalName: 'TodoWrite',
  aliases: ['TodoWrite'],
  cursorToolType: 'updateTodosToolCall',
  execArgsType: null,
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    todos: arr<Record<string, unknown>>(input.todos),
    merge: bool(input.merge),
  }),
}
