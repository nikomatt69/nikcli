export { RemoteService, remoteService } from "./remote-service"
export { SessionManager } from "./session-manager"
export { QRRenderer, qrRenderer } from "./qr-renderer"
export {
  RemoteNotificationManager,
  remoteNotifications,
  sendRemoteNotification,
  notifyTaskStarted,
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyInputRequired,
  notifyProgress,
  notifyInfo,
} from "./notifications"
export {
  type SubagentRemoteHooks,
  createSubagentRemoteHooks,
  getSubagentRemoteHooks,
  attachRemoteHooksToAgentService,
  createTaskInfo,
} from "./subagent-hooks"
export type {
  SessionStatus,
  DeviceInfo,
  RemoteSession,
  SessionOptions,
  RemoteServiceConfig,
  BroadcastMessage,
  RemoteNotification,
  TaskInfo,
  SubagentResult,
  InputPrompt,
  RemoteSessionPersistence,
  SubagentRemoteEvent,
} from "./types"
export { DEFAULT_REMOTE_CONFIG } from "./types"
