/**
 * Agent Session 管理
 *
 * SSE 降级模式下，Client 通过两个独立通道通信:
 *   - BidiAppend (unary) — 发送 AgentClientMessage (data=base64 proto)
 *   - RunSSE (server_streaming) — 接收 AgentServerMessage 流
 *
 * 两者通过 requestId 关联。Session 维护一个 per-requestId 的消息队列，
 * BidiAppend 写入消息，RunSSE 消费消息并驱动 LLM 调用。
 */
import { fromBinary, toJson } from '@bufbuild/protobuf';
import { AgentClientMessageSchema } from '../../gen/agent_v1_pb';
import { logger } from '../../logger';

/**
 * 后台 job 登记项。
 *
 * Shell 转后台(ShellStreamBackgrounded)与 Subagent 转后台(SubagentSuccess.backgroundReason)后,
 * LLM 会在后续轮次调用 AwaitShell(task_id=...) 轮询其状态。AwaitShell 需要据 task_id 区分:
 *   - shell  : 走 readArgs 通道, 读取 {terminalsFolder}/{shellId}.txt 终端文件
 *   - subagent: 走 subagentAwaitArgs 通道 (agentId)
 * 因此必须在转后台时按 task_id 登记 kind + 路由所需信息。
 *
 * 作用域选择: 后台 shell 的 AwaitShell 轮询发生在 **同一个 agent run** 的后续工具调用里,
 * 与转后台事件共享同一 requestId/session(handleConversationRun 单次调用贯穿全部 round)。
 * 故注册表挂在 session 上, 而非全局 Map。
 */
export interface BackgroundJob {
    kind: 'shell' | 'subagent';
    /** shell job: 执行侧回报的 shell_id (AwaitShell 的 task_id) */
    shellId?: number;
    /** subagent job: SubagentSuccess.agentId (AwaitShell 的 task_id) */
    agentId?: string;
    /** shell job: 终端输出文件所在目录 (env.terminalsFolder), 文件为 {terminalsFolder}/{shellId}.txt */
    terminalsFolder?: string;
    /** subagent job: transcript 文件路径 (SubagentSuccess.transcriptPath), 供日志/降级使用 */
    transcriptPath?: string;
    command?: string;
}

export interface AgentSession {
    requestId: string;
    messages: Array<Record<string, unknown>>;
    /** @deprecated 保留向后兼容，新代码使用 listeners */
    notify: (() => void) | null;
    listeners: Set<() => void>;
    closed: boolean;
    /**
     * 后台 job 注册表 (key = task_id 字符串形式: shell 用 shellId, subagent 用 agentId)。
     * 转后台时登记, AwaitShell 据此分流 readArgs / subagentAwaitArgs。
     */
    backgroundJobs: Map<string, BackgroundJob>;
    /** env.terminalsFolder — 用于构造后台 shell 的终端文件路径 {terminalsFolder}/{shellId}.txt */
    terminalsFolder?: string;
    /**
     * 客户端 cancelAction 携带的 reason;一经设置即表示本 run 已被客户端中断。
     *
     * 客户端中断当前生成 (点停止、提交新消息抢占、steer 降级后升级为 interrupt)
     * 时,ControlledConversationActionManager.abort() 会往同一条 BiDi 客户端流
     * 发 ConversationAction{cancelAction},随后才本地 abort。这是服务端唯一能
     * 感知"该停了"的信号 —— 不消费它,旧 run 会一直跑到 LLM 流自然结束,
     * 表现为"发新消息时前一条没有被终止"。
     *
     * 与 closed 的区别: closed 是传输层断开,cancelled 是应用层中断,
     * 后者到达时连接仍然活着(客户端还要用它接收后续帧)。
     */
    cancelledReason?: string;
}

export function createEphemeralSession(requestId: string): AgentSession {
    return {
        requestId,
        messages: [],
        notify: null,
        listeners: new Set(),
        closed: false,
        backgroundJobs: new Map(),
    };
}

/**
 * 判定一条 AgentClientMessage 是否为 steer 的运行中上下文注入。
 *
 * injectContextAction 与 userMessageAction / cancelAction 平级挂在
 * ConversationAction 上,走同一条 BiDi 客户端流发来。
 */
function isContextInjection(json: Record<string, unknown>): boolean {
    const action = json.conversationAction as Record<string, unknown> | undefined;
    return action !== undefined && 'injectContextAction' in action;
}

/**
 * 判定一条 AgentClientMessage 是否为客户端中断信号,并取出 reason。
 *
 * 判据是 cancelAction 存不存在,不是 reason 有没有值 —— proto3 里空字符串
 * 与缺省不可区分,而客户端确实可能发不带 reason 的中断。
 *
 * 实测 reason (3.17.19):
 *   "new_message_submitted"    submitChatMaybeAbortCurrent,提交新消息抢占当前生成
 *   "user_stopped_generation"  用户点停止按钮
 */
function extractCancelReason(json: Record<string, unknown>): string | undefined {
    const action = json.conversationAction as Record<string, unknown> | undefined;
    if (!action || !('cancelAction' in action))
        return undefined;
    const cancel = action.cancelAction as Record<string, unknown> | undefined;
    const reason = cancel?.reason;
    return typeof reason === 'string' && reason ? reason : 'cancelled';
}

/**
 * 消息入队的统一入口。两条上行通道 (bidi 的 pushSessionMessage、SSE 降级的
 * appendMessage) 都经过这里,保证不论客户端走哪条路都是同一套处理。
 *
 * 三类去向:
 *   injectContextAction — 丢弃 (见下)
 *   cancelAction        — 记为中断信号
 *   其余                — 进 messages 供 waitForMessageMatching 消费
 *
 * 丢弃注入的理由: 我们不支持运行中注入,而客户端对"服务端没有应答"本就有兜底 ——
 * run 结束时 reconcileSteerItemsWhenIdle 会撤掉乐观气泡、把消息退回队列,
 * 随后 tryDispatchNextQueueItem 自动发出,消息不会丢。但它没有任何
 * waitForMessageMatching 的 predicate 会匹配,留在 messages 里只会无限堆积。
 */
function ingestSessionMessage(session: AgentSession, json: Record<string, unknown>): void {
    if (isContextInjection(json)) {
        logger.debug({ requestId: session.requestId }, '[SESSION] dropping context injection (run-time injection unsupported)');
        return;
    }
    const cancelReason = extractCancelReason(json);
    if (cancelReason !== undefined) {
        // 只认第一次 —— 客户端可能重复发,reason 以最先到达的为准
        if (session.cancelledReason === undefined) {
            session.cancelledReason = cancelReason;
            logger.info({ requestId: session.requestId, reason: cancelReason }, '[CANCEL] client cancelled the run');
        }
    }
    else {
        session.messages.push(json);
    }
    notifyAll(session);
}

/** 客户端是否已中断本 run。 */
export function isSessionCancelled(session: AgentSession): boolean {
    return session.cancelledReason !== undefined;
}

/** 登记一个后台 job, 供后续 AwaitShell 分流。key = task_id 字符串形式。 */
export function registerBackgroundJob(session: AgentSession, taskId: string, job: BackgroundJob): void {
    session.backgroundJobs.set(taskId, job);
    logger.info({ requestId: session.requestId, taskId, kind: job.kind }, '[SESSION] background job registered');
}

/** 按 task_id 查找已登记的后台 job。 */
export function getBackgroundJob(session: AgentSession, taskId: string): BackgroundJob | undefined {
    return session.backgroundJobs.get(taskId);
}

function notifyAll(session: AgentSession): void {
    session.notify?.();
    for (const fn of session.listeners) fn();
}

export function pushSessionMessage(session: AgentSession, json: Record<string, unknown>): void {
    ingestSessionMessage(session, json);
}

export function markSessionClosed(session: AgentSession): void {
    session.closed = true;
    notifyAll(session);
}

const sessions = new Map<string, AgentSession>();

export function getOrCreateSession(requestId: string): AgentSession {
    let session = sessions.get(requestId);
    if (!session) {
        // 复用 createEphemeralSession —— 两处各自写字面量时,新增字段容易只补一处
        session = createEphemeralSession(requestId);
        sessions.set(requestId, session);
        logger.debug({ requestId }, '[SESSION] created');
    }
    return session;
}

/** BidiAppend 调用时，将消息推入 session 队列 */
export function appendMessage(requestId: string, data: string): void {
    const session = getOrCreateSession(requestId);

    // data 是 proto string 类型，实际承载的是 protobuf binary 的 hex 字符串表示。
    // "0ad88200a00012..." → hex decode → protobuf bytes
    try {
        const bytes = Buffer.from(data, 'hex');
        const clientMsg = fromBinary(AgentClientMessageSchema, bytes);
        const json = toJson(AgentClientMessageSchema, clientMsg) as Record<string, unknown>;
        const keys = Object.keys(json);
        logger.info({ requestId, keys, protoBytes: bytes.length }, '[SESSION] appendMessage');
        ingestSessionMessage(session, json);
    } catch (e) {
        logger.warn({ requestId, dataLen: data.length, error: (e as Error).message }, '[SESSION] proto decode failed');
    }
}

/** 等待下一条消息（任意类型） */
export async function waitForMessage(
    session: AgentSession,
    timeoutMs: number | null = 30_000,
): Promise<Record<string, unknown> | null> {
    return waitForMessageMatching(session, () => true, timeoutMs);
}

/**
 * 等待匹配特定条件的消息
 *
 * 不匹配的消息会被跳过（留在队列中供后续消费）。
 * 用于在 tool call 场景下等待 execClientMessage，
 * 而不被 kvClientMessage/clientHeartbeat 干扰。
 */
export async function waitForMessageMatching(
    session: AgentSession,
    predicate: (msg: Record<string, unknown>) => boolean,
    timeoutMs: number | null = 30_000,
): Promise<Record<string, unknown> | null> {
    // 先检查队列中是否已有匹配消息
    const idx = session.messages.findIndex(predicate);
    if (idx >= 0) {
        return session.messages.splice(idx, 1)[0];
    }
    // cancelled 与 closed 同样立即结束等待 —— 调用方 (wait.ts) 据
    // session.cancelledReason 区分二者,把前者转成 AgentRunAbortedError
    if (session.closed || session.cancelledReason !== undefined) return null;

    return new Promise<Record<string, unknown> | null>((resolve) => {
        let resolved = false;
        // 先声明再赋值：cleanup 同时引用这两个变量，而 cleanup 可能在
        // timeoutMs == null（无定时器）且 listener 被同步触发的路径上、
        // 早于它们完成初始化就被调用 —— 那时会撞上 const 的 TDZ。
        let timer: ReturnType<typeof setTimeout> | null = null;
        let listener: () => void = () => {};

        const cleanup = () => {
            resolved = true;
            if (timer != null)
                clearTimeout(timer);
            session.listeners.delete(listener);
        };

        if (timeoutMs != null) {
            timer = setTimeout(() => {
                if (resolved)
                    return;
                cleanup();
                logger.warn({ requestId: session.requestId, timeoutMs }, '[SESSION] waitForMessage timeout');
                resolve(null);
            }, timeoutMs);
        }

        listener = () => {
            if (resolved)
                return;
            const i = session.messages.findIndex(predicate);
            if (i >= 0) {
                cleanup();
                resolve(session.messages.splice(i, 1)[0]);
                return;
            }
            if (session.closed || session.cancelledReason !== undefined) {
                cleanup();
                resolve(null);
            }
        };

        session.listeners.add(listener);
    });
}

export async function waitForInteractionResponse(
    session: AgentSession,
    id: number,
    expectedCase: string,
    timeoutMs: number | null = 60_000,
): Promise<Record<string, unknown> | null> {
    return waitForMessageMatching(
        session,
        (msg) => {
            if (!('interactionResponse' in msg)) return false;
            const response = msg.interactionResponse as Record<string, unknown> | undefined;
            if (!response) return false;
            const responseId = typeof response.id === 'number' ? response.id : Number(response.id);
            return responseId === id && expectedCase in response;
        },
        timeoutMs,
    );
}

export function closeSession(requestId: string): void {
    const session = sessions.get(requestId);
    if (session) {
        session.closed = true;
        notifyAll(session);
        sessions.delete(requestId);
        logger.debug({ requestId }, '[SESSION] closed');
    }
}
