/**
 * Every command module, as data.
 *
 * The list used to be implicit in `cli-main.ts`'s chain of `.command(...)` calls,
 * which meant the generator and both parity tests had to parse that file with
 * regexes to find out what existed. With the yargs entrypoint gone there is no
 * such file, and an explicit list is what `script/generate-cli.ts` reads to build
 * the command tree and what `test/cli/*-parity.test.ts` reads to compare against.
 *
 * Nothing imports this at runtime: the CLI runs off the generated tree in
 * `commands.ts`, whose handlers import their module on demand.
 */
export interface CommandModuleRef {
  /** The module's exported command object. */
  readonly exportName: string
  /** Its import specifier. */
  readonly from: string
}

export const CommandModules: ReadonlyArray<CommandModuleRef> = [
  { exportName: "TuiThreadCommand", from: "@/cli/cmd/tui/thread" },
  { exportName: "AttachCommand", from: "@/cli/cmd/tui/attach" },
  { exportName: "GenerateCommand", from: "@/cli/cmd/generate" },
  { exportName: "AcpCommand", from: "@/cli/cmd/acp" },
  { exportName: "McpCommand", from: "@/cli/cmd/mcp" },
  { exportName: "AdsCommand", from: "@/cli/cmd/ads" },
  { exportName: "RunCommand", from: "@/cli/cmd/run" },
  { exportName: "GoalCommand", from: "@/cli/cmd/goal" },
  { exportName: "AnalyticsCommand", from: "@/cli/cmd/analytics" },
  { exportName: "ApiCommand", from: "@/cli/cmd/api" },
  { exportName: "DebugCommand", from: "@/cli/cmd/debug" },
  { exportName: "AuthCommand", from: "@/cli/cmd/auth" },
  { exportName: "AccountCommand", from: "@/cli/cmd/account" },
  { exportName: "ArtifactCommand", from: "@/cli/cmd/artifact" },
  { exportName: "AgentCommand", from: "@/cli/cmd/agent" },
  { exportName: "UpgradeCommand", from: "@/cli/cmd/upgrade" },
  { exportName: "QuickstartCommand", from: "@/cli/cmd/quickstart" },
  { exportName: "DoctorCommand", from: "@/cli/cmd/doctor" },
  { exportName: "UninstallCommand", from: "@/cli/cmd/uninstall" },
  { exportName: "ServeCommand", from: "@/cli/cmd/serve" },
  { exportName: "ServiceCommand", from: "@/cli/cmd/service" },
  { exportName: "WorkspaceServeCommand", from: "@/cli/cmd/workspace-serve" },
  { exportName: "WebCommand", from: "@/cli/cmd/web" },
  { exportName: "HeapCommand", from: "@/cli/cmd/heap" },
  { exportName: "ModelsCommand", from: "@/cli/cmd/models" },
  { exportName: "LocaleCommand", from: "@/cli/cmd/locale" },
  { exportName: "StatsCommand", from: "@/cli/cmd/stats" },
  { exportName: "ExportCommand", from: "@/cli/cmd/export" },
  { exportName: "ImportCommand", from: "@/cli/cmd/import" },
  { exportName: "GithubCommand", from: "@/cli/cmd/github" },
  { exportName: "PrCommand", from: "@/cli/cmd/pr" },
  { exportName: "SessionCommand", from: "@/cli/cmd/session" },
  { exportName: "ImageModelCommand", from: "@/cli/cmd/image-model" },
  { exportName: "SpeakModelCommand", from: "@/cli/cmd/speak-model" },
  { exportName: "BrainModelCommand", from: "@/cli/cmd/brain-model" },
  { exportName: "RemoteCommand", from: "@/cli/cmd/remote" },
  { exportName: "TeleportCommand", from: "@/cli/cmd/teleport" },
  { exportName: "CompanionCommand", from: "@/cli/cmd/companion" },
  { exportName: "MobileCommand", from: "@/cli/cmd/mobile" },
  { exportName: "RoutineCommand", from: "@/cli/cmd/routine" },
  { exportName: "MissionCommand", from: "@/cli/cmd/mission" },
  { exportName: "UsageCommand", from: "@/cli/cmd/usage" },
  { exportName: "PluginCommand", from: "@/cli/cmd/plug" },
  { exportName: "SyncCommand", from: "@/cli/cmd/sync" },
  { exportName: "ConnectorsCommand", from: "@/cli/cmd/connectors" },
  { exportName: "BotCommand", from: "@/cli/cmd/chatbot" },
]
