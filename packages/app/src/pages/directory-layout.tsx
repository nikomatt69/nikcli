import { createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"

import { DataProvider } from "@nikcli-ai/ui/context"
import { iife } from "@nikcli-ai/util/iife"
import type { QuestionAnswer } from "@nikcli-ai/sdk/httpapi"
import { decode64 } from "@/utils/base64"
import { showToast } from "@nikcli-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useDialog } from "@nikcli-ai/ui/context/dialog"
import { useCommand, type CommandOption } from "@/context/command"
import { DialogStatus } from "@/components/dialog-status"
import { DialogRoutines } from "@/components/dialog-routines"
import { DialogAnalytics } from "@/components/dialog-analytics"
import { DialogAdvisorModel } from "@/components/dialog-advisor-model"
import { DialogConnectors } from "@/components/dialog-connectors"
import { DialogOpenTelemetry } from "@/components/dialog-opentelemetry"
import { DialogSkills } from "@/components/dialog-skills"
import { DialogBrain } from "@/components/dialog-brain"
import { DialogDoctor } from "@/components/dialog-doctor"

function DirectoryCommands() {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()

  command.register("directory-tools", () => {
    const commands: CommandOption[] = [
      {
        id: "nikcli.status",
        title: language.t("command.status.open"),
        category: language.t("command.category.system"),
        slash: "status",
        onSelect: () => dialog.show(() => <DialogStatus />),
      },
      {
        id: "routine.list",
        title: language.t("command.routines.open"),
        category: language.t("command.category.system"),
        slash: "routines",
        onSelect: () => dialog.show(() => <DialogRoutines />),
      },
      {
        id: "analytics.view",
        title: language.t("command.analytics.open"),
        category: language.t("command.category.system"),
        slash: "analytics",
        onSelect: () => dialog.show(() => <DialogAnalytics />),
      },
      {
        id: "agent.advisor",
        title: language.t("command.advisor.open"),
        category: language.t("command.category.agent"),
        slash: "advisor",
        onSelect: () => dialog.show(() => <DialogAdvisorModel />),
      },
      {
        id: "connectors.list",
        title: language.t("command.connectors.open"),
        category: language.t("command.category.system"),
        slash: "connectors",
        onSelect: () => dialog.show(() => <DialogConnectors />),
      },
      {
        id: "otel.settings",
        title: language.t("command.otel.open"),
        category: language.t("command.category.system"),
        slash: "otel",
        onSelect: () => dialog.show(() => <DialogOpenTelemetry />),
      },
      {
        id: "skill.list",
        title: language.t("command.skills.open"),
        category: language.t("command.category.agent"),
        slash: "skills",
        onSelect: () => dialog.show(() => <DialogSkills />),
      },
      {
        id: "brain.run",
        title: language.t("command.brain.open"),
        category: language.t("command.category.system"),
        slash: "brain",
        onSelect: () => dialog.show(() => <DialogBrain />),
      },
      {
        id: "support.doctor",
        title: language.t("command.doctor.open"),
        category: language.t("command.category.system"),
        slash: "doctor",
        onSelect: () => dialog.show(() => <DialogDoctor />),
      },
    ]

    return commands
  })

  return null
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const directory = createMemo(() => {
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/")
  })
  return (
    <Show when={directory()}>
      <SDKProvider directory={directory}>
        <SyncProvider>
          {iife(() => {
            const sync = useSync()
            const sdk = useSDK()
            const respond = (input: {
              sessionID: string
              permissionID: string
              response: "once" | "always" | "reject"
            }) => sdk.client.permission.respond(input)

            const replyToQuestion = (input: { requestID: string; answers: QuestionAnswer[] }) =>
              sdk.client.question.reply(input)

            const rejectQuestion = (input: { requestID: string }) => sdk.client.question.reject(input)

            const navigateToSession = (sessionID: string) => {
              navigate(`/${params.dir}/session/${sessionID}`)
            }

            return (
              <>
                <DirectoryCommands />
                <DataProvider
                  data={sync.data}
                  directory={directory()}
                  onPermissionRespond={respond}
                  onQuestionReply={replyToQuestion}
                  onQuestionReject={rejectQuestion}
                  onNavigateToSession={navigateToSession}
                >
                  <LocalProvider>{props.children}</LocalProvider>
                </DataProvider>
              </>
            )
          })}
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
