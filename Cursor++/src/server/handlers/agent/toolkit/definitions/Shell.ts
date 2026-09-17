import type { ToolRegistryEntry } from '../types'
import { SHELL_DEFAULT_TIMEOUT_MS, SHELL_FILE_OUTPUT_THRESHOLD_BYTES, SHELL_HARD_TIMEOUT_MS, SHELL_TIMEOUT_BEHAVIOR_BACKGROUND } from '../../constants'
import { num, str } from '../shared'

function buildShellStartedArgs(input: Record<string, unknown>, callId: string): Record<string, unknown> {
  const command = str(input.command)
  const parts = command.trim().split(/\s+/).filter(Boolean)
  return {
    command,
    workingDirectory: str(input.workingDirectory ?? input.cwd),
    timeout: num(input.timeout, SHELL_DEFAULT_TIMEOUT_MS),
    toolCallId: callId,
    simpleCommands: parts.length > 0 ? [parts[0]] : [],
    hasInputRedirect: false,
    hasOutputRedirect: false,
    isBackground: false,
    skipApproval: false,
    timeoutBehavior: SHELL_TIMEOUT_BEHAVIOR_BACKGROUND,
    hardTimeout: num(input.hardTimeout, SHELL_HARD_TIMEOUT_MS),
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
    parsingResult: parts.length > 0
      ? {
          executableCommands: [{
            name: parts[0],
            fullText: command,
            args: parts.slice(1).map(value => ({ type: 'word', value })),
          }],
        }
      : undefined,
    fileOutputThresholdBytes: SHELL_FILE_OUTPUT_THRESHOLD_BYTES,
  }
}

function buildShellExecArgs(input: Record<string, unknown>, callId: string): Record<string, unknown> {
  const command = str(input.command)
  const parts = command.trim().split(/\s+/)
  const cmdName = parts[0] || ''
  const cmdArgs = parts.slice(1).map(a => ({ type: 'word', value: a }))
  return {
    command,
    workingDirectory: str(input.workingDirectory ?? input.cwd),
    timeout: (input.timeout as number) || SHELL_DEFAULT_TIMEOUT_MS,
    toolCallId: callId,
    description: (input.description as string) || '',
    simpleCommands: [cmdName],
    parsingResult: {
      executableCommands: [{
        name: cmdName,
        args: cmdArgs,
        fullText: command,
      }],
    },
    fileOutputThresholdBytes: SHELL_FILE_OUTPUT_THRESHOLD_BYTES,
    timeoutBehavior: SHELL_TIMEOUT_BEHAVIOR_BACKGROUND,
    hardTimeout: SHELL_HARD_TIMEOUT_MS,
  }
}

const ANTHROPIC = {
  name: 'Shell',
  description: `Executes a command in a shell session with optional foreground timeout.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Check for Running Processes:
   - Before starting dev servers or long-running processes that should not be duplicated, list the terminals folder to check if they are already running in existing terminals.
   - You can use this information to determine which terminal, if any, matches the command you want to run, contains the output from the command you want to inspect, or has changed since you last read them.
   - Since these are text files, you can read any terminal's contents simply by reading the file, search using Grep, etc.
2. Directory Verification:
   - If the command will create new directories or files, first run ls to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first run 'ls' to check that "foo" exists and is the intended parent directory
3. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:

- The command argument is required.
- The shell starts in the workspace root and is stateful across sequential calls. Current working directory and environment variables persist between calls. Use the \`working_directory\` parameter to run commands in different directories. Example: to run \`npm install\` in the \`frontend\` folder, set \`working_directory: "frontend"\` rather than using \`cd frontend && npm install\`.
- It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
- VERY IMPORTANT: You MUST avoid using search commands like \`find\` and \`grep\`.Instead use Grep, Glob to search.You MUST avoid read tools like \`cat\`, \`head\`, and \`tail\`, and use Read to read files.Avoid editing files with tools like \`sed\` and \`awk\`, use Edit instead.
- If you _still_ need to run \`grep\`, STOP. ALWAYS USE ripgrep at \`rg\` first, which all users have pre-installed.
- When issuing multiple commands:
   - If the commands are independent and can run in parallel, make multiple Shell tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Shell tool calls in parallel.
   - If the commands depend on each other and must run sequentially, use a single Shell call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp,Write before Shell for git operations, or git add before git commit), run these operations sequentially instead.
   - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
   - DO NOT use newlines to separate commands (newlines are ok in quoted strings)

Dependencies:

When adding new dependencies, prefer using the package manager (e.g. npm, pip) to add the latest version. Do not make up dependency versions.

<managing-long-running-commands>
- Commands that don't complete within \`block_until_ms\` (default 30000ms / 30 seconds) are moved to background. The command keeps running and output streams to a terminal file. Set \`block_until_ms: 0\` to immediately background (use for dev servers, watchers, or any long-running process).
- You do not need to use '&' at the end of commands.
- Make sure to set \`block_until_ms\` to higher than the command's expected runtime. Add some buffer since block_until_ms includes shell startup time; increase buffer next time based on \`elapsed_ms\` if you chose too low. E.g. if you sleep for 40s, recommended \`block_until_ms\` is 45s.
- Use the \`Await\` tool to monitor the background command. If under your control, prefer commands that print periodic status updates so you can monitor effectively.
</managing-long-running-commands>

<committing-changes-with-git>
Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

Git Safety Protocol:

- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Avoid git commit --amend. ONLY use --amend when ALL conditions are met:
  1. User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files that need including
  2. HEAD commit was created by you in this conversation (verify: git log -1 --format='%an %ae')
  3. Commit has NOT been pushed to remote (verify: git status shows "Your branch is ahead")
- CRITICAL: If commit FAILED or was REJECTED by hook, NEVER amend - fix the issue and create a NEW commit
- CRITICAL: If you already pushed to remote, NEVER amend unless user explicitly requests it (requires force push)
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel, each using the Shell tool:
   - Run a git status command to see all untracked files.
   - Run a git diff command to see both staged and unstaged changes that will be committed.
   - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
   - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
   - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
   - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
   - Ensure it accurately reflects the changes and their purpose
3. Run the following commands sequentially:
   - Add relevant untracked files to the staging area.
   - Commit the changes with the message.
   - Run git status after the commit completes to verify success.
4. If the commit fails due to pre-commit hook, fix the issue and create a NEW commit (see amend rules above)

Important notes:

- NEVER update the git config
- NEVER run additional commands to read or explore code, besides git shell commands
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:

<example>git commit -m "$(cat <<'EOF'
Commit message here.

EOF
)"</example>
</committing-changes-with-git>

<creating-pull-requests>
Use the gh command via the Shell tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel using the Shell tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and \`git diff [base-branch]...HEAD\` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request summary
3. Run the following commands sequentially:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.

<example># First, push the branch (with required_permissions: ["all"])
git push -u origin HEAD

# Then create the PR (with required_permissions: ["all"])
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Checklist of TODOs for testing the pull request...]

EOF
)"</example>

Important:

- NEVER update the git config
- DO NOT use the TodoWrite or Task tools
- Return the PR URL when you're done, so the user can see it
</creating-pull-requests>

<other-common-operations>
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments
</other-common-operations>`,
  inputSchema: {
    type: 'object',
    required: [
      'command',
    ],
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      description: {
        type: 'string',
        description: 'Clear, concise description of what this command does in 5-10 words',
      },
      working_directory: {
        type: 'string',
        description: 'The absolute path to the working directory to execute the command in (defaults to current directory)',
      },
      block_until_ms: {
        type: 'number',
        description: 'How long to block and wait for the command to complete before moving it to background (in milliseconds). Defaults to 30000ms (30 seconds). Set to 0 to immediately run the command in the background. The timer includes the shell startup time.',
      },
    },
  },
}

const OPENAI = {
  name: 'Shell',
  description: `Executes a given command in a shell session with optional foreground timeout.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Check for Running Processes:
- Before starting dev servers or long-running processes that should not be duplicated, list the terminals folder to check if they are already running in existing terminals.
- You can use this information to determine which terminal, if any, matches the command you want to run, contains the output from the command you want to inspect, or has changed since you last read them.
- Since these are text files, you can read any terminal's contents simply by reading the file, search using rg, etc.
2. Directory Verification:
- If the command will create new directories or files, first run ls to verify the parent directory exists and is the correct location
- For example, before running "mkdir foo/bar", first run 'ls' to check that "foo" exists and is the intended parent directory
3. Command Execution:
- Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
- Examples of proper quoting:
- cd "/Users/name/My Documents" (correct)
- cd /Users/name/My Documents (incorrect - will fail)
- python "/path/with spaces/script.py" (correct)
- python /path/with spaces/script.py (incorrect - will fail)
- After ensuring proper quoting, execute the command.
- Capture the output of the command.

Usage notes:

- The command argument is required.
- The shell starts in the workspace root and is stateful across sequential calls. Current working directory and environment variables persist between calls. Use the \`working_directory\` parameter to run commands in different directories. Example: to run \`npm install\` in the \`frontend\` folder, set \`working_directory: "frontend"\` rather than using \`cd frontend && npm install\`.
- It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
- VERY IMPORTANT: You MUST avoid using search commands like \`find\` and \`grep\`.Instead use rg, Glob to search.You MUST avoid read tools like \`cat\`, \`head\`, and \`tail\`, and use ReadFile to read files.
- If you _still_ need to run \`grep\`, STOP. ALWAYS USE ripgrep at \`rg\` first, which all users have pre-installed.
- When issuing multiple commands:
- If the commands are independent and can run in parallel, make multiple Shell tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Shell tool calls in parallel.
- If the commands depend on each other and must run sequentially, use a single Shell call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp, or git add before git commit), run these operations sequentially instead.
- Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
- DO NOT use newlines to separate commands (newlines are ok in quoted strings)

Dependencies:

- When adding new dependencies, prefer using the package manager (e.g. npm, pip) to add the latest version. Do not make up dependency versions.

<managing-long-running-commands>
- Commands that don't complete within \`block_until_ms\` (default 30000ms / 30 seconds) are moved to background. The command keeps running and output streams to a terminal file. Set \`block_until_ms: 0\` to immediately background (use for dev servers, watchers, or any long-running process).
- You do not need to use '&' at the end of commands.
- Make sure to set \`block_until_ms\` to higher than the command's expected runtime. Add some buffer since block_until_ms includes shell startup time; increase buffer next time based on \`elapsed_ms\` if you chose too low. E.g. if you sleep for 40s, recommended \`block_until_ms\` is 45s.
- Use the \`Await\` tool to monitor the background command. If under your control, prefer commands that print periodic status updates so you can monitor effectively.
</managing-long-running-commands>

<committing-changes-with-git>
Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

Git Safety Protocol:

- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Avoid git commit --amend. ONLY use --amend when ALL conditions are met:
1. User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files that need including
2. HEAD commit was created by you in this conversation (verify: git log -1 --format='%an %ae')
3. Commit has NOT been pushed to remote (verify: git status shows "Your branch is ahead")
- CRITICAL: If commit FAILED or was REJECTED by hook, NEVER amend - fix the issue and create a NEW commit
- CRITICAL: If you already pushed to remote, NEVER amend unless user explicitly requests it (requires force push)
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel, each using the Shell tool:
- Run a git status command to see all untracked files.
- Run a git diff command to see both staged and unstaged changes that will be committed.
- Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
- Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
- Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
- Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
- Ensure it accurately reflects the changes and their purpose
3. Run the following commands sequentially:
- Add relevant untracked files to the staging area.
- Commit the changes with the message.
- Run git status after the commit completes to verify success.
4. If the commit fails due to pre-commit hook, fix the issue and create a NEW commit (see amend rules above)

Important notes:

- NEVER update the git config
- NEVER run additional commands to read or explore code, besides git shell commands
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- If there are no changes to commit (i.e. no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:

<example>git commit -m "$(cat <<'EOF'
Commit message here.

EOF
)"</example>
</committing-changes-with-git>

<creating-pull-requests>
Use the gh command via the Shell tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel using the Shell tool, in order to understand the current state of the branch since it diverged from the main branch:
- Run a git status command to see all untracked files
- Run a git diff command to see both staged and unstaged changes that will be committed
- Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
- Run a git log command and \`git diff [base-branch]...HEAD\` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request summary
3. Run the following commands sequentially:
- Create new branch if needed
- Push to remote with -u flag if needed
- Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.

<example># First, push the branch (with required_permissions: ["all"])
git push -u origin HEAD

# Then create the PR (with required_permissions: ["all"])
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Checklist of TODOs for testing the pull request...]

EOF
)"</example>

Important:

- NEVER update the git config
- DO NOT use the TodoWrite or Task tools
- Return the PR URL when you're done, so the user can see it
</creating-pull-requests>

<other-common-operations>
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments
</other-common-operations>`,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      working_directory: {
        type: 'string',
        description: 'The absolute path to the working directory to execute the command in (defaults to current directory)',
      },
      block_until_ms: {
        type: 'number',
        description: 'How long to block and wait for the command to complete before moving it to background (in milliseconds). Defaults to 30000ms (30 seconds). Set to 0 to immediately run the command in the background. The timer includes the shell startup time.',
      },
      description: {
        type: 'string',
        description: 'Clear, concise description of what this command does in 5-10 words',
      },
    },
    required: [
      'command',
    ],
  },
}

const GEMINI = {
  name: 'Shell',
  description: `Executes a given command in a shell session with optional foreground timeout.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Check for Running Processes:
   - Before starting dev servers or long-running processes that should not be duplicated, list the terminals folder to check if they are already running in existing terminals.
   - You can use this information to determine which terminal, if any, matches the command you want to run, contains the output from the command you want to inspect, or has changed since you last read them.
   - Since these are text files, you can read any terminal's contents simply by reading the file, search using Grep, etc.
2. Directory Verification:
   - If the command will create new directories or files, first run ls to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first run 'ls' to check that "foo" exists and is the intended parent directory
3. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:

- The command argument is required.
- The shell starts in the workspace root and is stateful across sequential calls. Current working directory and environment variables persist between calls. Use the \`working_directory\` parameter to run commands in different directories. Example: to run \`npm install\` in the \`frontend\` folder, set \`working_directory: "frontend"\` rather than using \`cd frontend && npm install\`.
- It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
- VERY IMPORTANT: You MUST avoid using search commands like \`find\` and \`grep\`.Instead use Grep, Glob to search.You MUST avoid read tools like \`cat\`, \`head\`, and \`tail\`, and use Read to read files.Avoid editing files with tools like \`sed\` and \`awk\`, use Edit instead.
- If you _still_ need to run \`grep\`, STOP. ALWAYS USE ripgrep at \`rg\` first, which all users have pre-installed.
- When issuing multiple commands:
  - If the commands are independent and can run in parallel, make multiple Shell tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Shell tool calls in parallel.
  - If the commands depend on each other and must run sequentially, use a single Shell call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp,Write before Shell for git operations, or git add before git commit), run these operations sequentially instead.
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings)

Dependencies:

When adding new dependencies, prefer using the package manager (e.g. npm, pip) to add the latest version. Do not make up dependency versions.

<managing-long-running-commands>
- Commands that don't complete within \`block_until_ms\` (default 30000ms / 30 seconds) are moved to background. The command keeps running and output streams to a terminal file. Set \`block_until_ms: 0\` to immediately background (use for dev servers, watchers, or any long-running process).
- You do not need to use '&' at the end of commands.
- Make sure to set \`block_until_ms\` to higher than the command's expected runtime. Add some buffer since block_until_ms includes shell startup time; increase buffer next time based on \`elapsed_ms\` if you chose too low. E.g. if you sleep for 40s, recommended \`block_until_ms\` is 45s.
- Use the \`Await\` tool to monitor the background command. If under your control, prefer commands that print periodic status updates so you can monitor effectively.
</managing-long-running-commands>

<committing-changes-with-git>
Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

Git Safety Protocol:

- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Avoid git commit --amend. ONLY use --amend when ALL conditions are met:
  1. User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files that need including
  2. HEAD commit was created by you in this conversation (verify: git log -1 --format='%an %ae')
  3. Commit has NOT been pushed to remote (verify: git status shows "Your branch is ahead")
- CRITICAL: If commit FAILED or was REJECTED by hook, NEVER amend - fix the issue and create a NEW commit
- CRITICAL: If you already pushed to remote, NEVER amend unless user explicitly requests it (requires force push)
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel, each using the Shell tool:
   - Run a git status command to see all untracked files.
   - Run a git diff command to see both staged and unstaged changes that will be committed.
   - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
   - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
   - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
   - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
   - Ensure it accurately reflects the changes and their purpose
3. Run the following commands sequentially:
   - Add relevant untracked files to the staging area.
   - Commit the changes with the message.
   - Run git status after the commit completes to verify success.
4. If the commit fails due to pre-commit hook, fix the issue and create a NEW commit (see amend rules above)

Important notes:

- NEVER update the git config
- NEVER run additional commands to read or explore code, besides git shell commands
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:

<example>git commit -m "$(cat <<'EOF'
Commit message here.

EOF
)"</example>
</committing-changes-with-git>

<creating-pull-requests>
Use the gh command via the Shell tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following shell commands in parallel using the Shell tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and \`git diff [base-branch]...HEAD\` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request summary
3. Run the following commands sequentially:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.

<example># First, push the branch (with required_permissions: ["all"])
git push -u origin HEAD

# Then create the PR (with required_permissions: ["all"])
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Checklist of TODOs for testing the pull request...]

EOF
)"</example>

Important:

- NEVER update the git config
- DO NOT use the TodoWrite or Task tools
- Return the PR URL when you're done, so the user can see it
</creating-pull-requests>

<other-common-operations>
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments
</other-common-operations>`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      block_until_ms: {
        type: 'NUMBER',
        description: 'How long to block and wait for the command to complete before moving it to background (in milliseconds). Defaults to 30000ms (30 seconds). Set to 0 to immediately run the command in the background. The timer includes the shell startup time.',
      },
      command: {
        type: 'STRING',
        description: 'The command to execute',
      },
      description: {
        type: 'STRING',
        description: 'Clear, concise description of what this command does in 5-10 words',
      },
      working_directory: {
        type: 'STRING',
        description: 'The absolute path to the working directory to execute the command in (defaults to current directory)',
      },
    },
    required: [
      'command',
    ],
  },
}

export const ShellTool: ToolRegistryEntry = {
  canonicalName: 'Shell',
  aliases: ['Shell'],
  cursorToolType: 'shellToolCall',
  execArgsType: 'shellStreamArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: buildShellStartedArgs,
  buildExecArgs: buildShellExecArgs,
}
