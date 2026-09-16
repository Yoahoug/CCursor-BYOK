/**
 * aiserver.v1.BackgroundComposerService — 云端 Agent 服务
 *
 * 105 方法，Cursor 云端 Agent (Background Composer / Bug Bot):
 *   - 生命周期: ListBackgroundComposers, Start, Pause, Resume, Archive, Fetch
 *   - 对话: AttachBackgroundComposer (stream), StreamConversation, StreamInteractionUpdates
 *   - PR 管理: MakePR, OpenPR, GetPullRequest*, MergePullRequest
 *   - 环境: SetPersonalEnvironmentJson, PublishEnvironment, ListTeamEnvironments
 *   - GitHub: GetGithubAccessTokenForRepos, RefreshGithubAccessToken
 *   - Pod/快照: CreatePod, AttachPod, CreateSnapshot, GetSnapshotInfo
 *   - 工件: ListArtifacts, GetArtifact, StreamArtifact
 *   - Slack/GitHub/Linear 集成: StartSlackStreamingForFollowup 等
 *
 * Transport: bcProxyTransport (bcProxyUrl)
 *   部分方法 (listBackgroundComposerSecrets 等) → backgroundComposerProxyTransport
 *
 * 注意: 此服务需要远程 VM/sandbox 环境，超出 BYOK 范围
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { BackgroundComposerService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(BackgroundComposerService, {
    // CloudAgentRepository 启动时会调 listBackgroundComposers 获取云端 agent 列表。
    // BYOK 模式下没有云端 agent,返回空列表消除 invalid_argument 错误。
    listBackgroundComposers: async () => ({ composers: [], didLoadStatus: true }),
    listDetailedBackgroundComposers: async () => ({ composers: [] }),
    fetchBackgroundComposer: async () => ({}),
    getBackgroundComposerInfo: async () => ({}),
    getBackgroundComposerStatus: async () => ({}),
    getBackgroundComposerUserSettings: async () => ({}),
    getMachine: async () => ({}),
    listTeamEnvironments: async () => ({ environments: [] }),
    listPersonalEnvironments: async () => ({ environments: [] }),
    listPendingFollowups: async () => ({ pendingFollowups: [] }),
    listGrindModeComposers: async () => ({ composers: [] }),
  })
}
