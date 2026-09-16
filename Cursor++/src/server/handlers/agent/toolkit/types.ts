import type { LLMTool } from '../../llm/types';
import type { ProviderType } from '../../../data/defaults';
import type { EditPlan } from './editPlans';

export interface ToolExecBuildOptions {
    conversationId?: string;
    currentModelId?: string;
}

/**
 * Provider 族 — 将 4 种 ProviderType 归约为 3 种工具目录。
 * openai-chat 与 openai-responses 共享同一套工具定义。
 */
export type ProviderFamily = 'anthropic' | 'openai' | 'gemini';

export function toProviderFamily(pt: ProviderType): ProviderFamily {
    switch (pt) {
        case 'anthropic': return 'anthropic';
        case 'openai-chat':
        case 'openai-responses': return 'openai';
        case 'gemini': return 'gemini';
        default: {
            // 这里不是"兜底默认值",而是**穷尽性断言**:
            // 新增 ProviderType 成员时 pt 会收窄成该成员, 赋给 never 即编译报错,
            // 强制在此补上映射。此前写的是 `default: return 'anthropic'`,
            // 会把新 provider 静默当成 Anthropic 处理 —— 工具定义与提示词全错,
            // 却一路不报错, 排查成本极高。
            // 真走到这里说明配置校验漏了一处, 明确抛错远好过静默降级。
            // (providersStore.withFallback 已在配置边界拦非法 type, 见 isProviderType)
            const unreachable: never = pt;
            throw new Error(`Unknown provider type: ${String(unreachable)}`);
        }
    }
}

/**
 * Cursor Agent 交互模式 — 决定暴露哪些工具给 LLM。
 * 客户端通过 AGENT_MODE_* 枚举传入，这里归约为小写。
 */
export type CursorAgentMode = 'agent' | 'ask' | 'plan' | 'debug';

/**
 * 模式工具集差异规则:
 *
 *   Agent (基准): 完整工具集
 *   Ask:          移除写入工具 + SwitchMode (双重保障: 工具层面 + system_reminder)
 *   Plan:         Agent + CreatePlan
 *   Debug:        Agent - SwitchMode
 *
 * 交叉核对 (cursor_prompt/ OAI + analysis/prompts/ Anthropic 提取):
 *   官方 Ask 保留了写入工具(只靠 system_reminder 约束),但 BYOK 选择
 *   更严格的设计: 工具层面也移除,防止 LLM 无视指令。
 */
const ASK_MODE_EXCLUDED_TOOLS = new Set([
    'Edit', 'Write', 'Delete', 'Task',
    'EditNotebook', 'GenerateImage', 'SwitchMode',
]);

// updateCurrentStep 只在子代理中可用 — 主代理/Plan/Debug 不需要向 parent 汇报进度
const SUBAGENT_ONLY_TOOLS = new Set([
    'updateCurrentStep',
]);

export function filterToolsForMode(tools: LLMTool[], mode: string, isSubagent = false): LLMTool[] {
    const normalized = mode.replace('AGENT_MODE_', '').toLowerCase() as CursorAgentMode;
    const filtered = isSubagent ? tools : tools.filter(t => !SUBAGENT_ONLY_TOOLS.has(t.name));
    switch (normalized) {
        case 'ask':
            return filtered.filter(t => !ASK_MODE_EXCLUDED_TOOLS.has(t.name) && t.name !== 'CreatePlan');
        case 'debug':
            return filtered.filter(t => t.name !== 'SwitchMode' && t.name !== 'CreatePlan');
        case 'plan':
            return filtered; // 完整工具集含 CreatePlan + SwitchMode
        case 'agent':
        default:
            return filtered.filter(t => t.name !== 'CreatePlan');
    }
}

export interface ToolRegistryEntry {
    canonicalName: string;
    /** 所有 provider 可能使用的工具名。LLM 回调时用 findToolByAlias() 匹配。 */
    aliases: string[];
    cursorToolType: string;
    execArgsType: string | null;
    /**
     * 按 provider 族分化的 LLM 工具定义。
     * 包含该工具面向 LLM 的 name / description / inputSchema。
     * 未列出的 provider 族不会暴露此工具。
     */
    llmToolByProvider: Partial<Record<ProviderFamily, LLMTool>>;
    buildStartedArgs?: (
        input: Record<string, unknown>,
        callId: string,
        options?: ToolExecBuildOptions,
    ) => Record<string, unknown>;
    buildExecArgs?: (
        input: Record<string, unknown>,
        callId: string,
        options?: ToolExecBuildOptions,
    ) => Record<string, unknown>;
    buildEditPlan?: (
        input: Record<string, unknown>,
        callId: string,
        options?: ToolExecBuildOptions,
    ) => EditPlan;
}
