/**
 * 服务注册入口 — 27 个 ConnectRPC 服务
 *
 * 按用途分类:
 *   core/       — 核心 AI 能力 (AiService, ChatService, AgentService, BackgroundComposer, Bidi, Replay)
 *   completion/ — 代码补全 (CppService, CmdKService, FileSyncService)
 *   account/    — 账户/设置 (DashboardService, AuthService, InAppAdService)
 *   telemetry/  — 遥测/事件 (Analytics, Metrics, Profiling, Trace, *EventService)
 *   infra/      — 基础设施 (ServerConfig, Network, Health)
 *   repo/       — 代码仓库 (Repository, GitIndex, Upload)
 *   mcp/        — MCP (MCPRegistryService)
 *
 * Transport 分布:
 *   api2 (BYOK 拦截)  — core/, account/, telemetry/ 大部分, infra/ServerConfig+Network, completion/Cpp
 *   api5 (BYOK 拦截)  — core/AgentService, infra/HealthService
 *   repo42 (不拦截)    — repo/*
 *   api3 (不拦截)      — completion/CmdKService
 *   geoCpp (不拦截)    — completion/FileSyncService
 *   bcProxy (BYOK stub) — core/BackgroundComposerService
 */
import type { ConnectRouter } from '@connectrpc/connect'

import AuthService from './account/AuthService'
// account
import DashboardService from './account/DashboardService'
import InAppAdService from './account/InAppAdService'
import CmdKService from './completion/CmdKService'
// completion
import CppService from './completion/CppService'
import FileSyncService from './completion/FileSyncService'

import AgentService from './core/AgentService'
// core
import AiService from './core/AiService'
import BackgroundComposerService from './core/BackgroundComposerService'

import BidiService from './core/BidiService'
import ChatService from './core/ChatService'
import ReplayChatService from './core/ReplayChatService'

import HealthService from './infra/HealthService'
import NetworkService from './infra/NetworkService'
// infra
import ServerConfigService from './infra/ServerConfigService'
// mcp
import MCPRegistryService from './mcp/MCPRegistryService'
import GitIndexService from './repo/GitIndexService'
// repo
import RepositoryService from './repo/RepositoryService'
import UploadService from './repo/UploadService'
// telemetry
import AnalyticsService from './telemetry/AnalyticsService'

import ChatRequestEventService from './telemetry/ChatRequestEventService'
import MetricsService from './telemetry/MetricsService'
import PerformanceEventService from './telemetry/PerformanceEventService'

import ProfilingService from './telemetry/ProfilingService'
import ToolCallEventService from './telemetry/ToolCallEventService'
import TraceService from './telemetry/TraceService'

import WebProfilingService from './telemetry/WebProfilingService'

export default (router: ConnectRouter) => {
  // core
  AiService(router)
  ChatService(router)
  AgentService(router)
  BackgroundComposerService(router)
  BidiService(router)
  ReplayChatService(router)

  // completion
  CppService(router)
  CmdKService(router)
  FileSyncService(router)

  // account
  DashboardService(router)
  AuthService(router)
  InAppAdService(router)

  // telemetry
  AnalyticsService(router)
  MetricsService(router)
  ProfilingService(router)
  WebProfilingService(router)
  TraceService(router)
  ChatRequestEventService(router)
  ToolCallEventService(router)
  PerformanceEventService(router)

  // infra
  ServerConfigService(router)
  NetworkService(router)
  HealthService(router)

  // repo
  RepositoryService(router)
  GitIndexService(router)
  UploadService(router)

  // mcp
  MCPRegistryService(router)
}
