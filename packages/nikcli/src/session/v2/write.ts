import { SyncEvent } from "@/sync/sync-event"
import type { MessageV2 } from "../message-v2"
import { SessionSync } from "../projectors"

/**
 * The conversation write helper.
 *
 * Slice 3 of the v2 write path: HTTP, `SessionV2.prompt`, share import,
 * `nikcli import`, and teleport share this so every conversation write
 * (idle persist, pending promotion, and imported transcripts) goes
 * through the same entry-first projector. `SyncEvent.run` nests into an
 * outer `Database.transaction`, which is how promotion stays one
 * transaction and one `step` reset (S1).
 *
 * Lives in its own module so `SessionPrompt` can call it without importing
 * `SessionV2` (that namespace imports the prompt engine).
 */
export namespace SessionV2Write {
  export function persist(input: { prepared: MessageV2.WithParts; promptData: string; projectID: string }): void {
    SessionSync.install()
    const sessionID = input.prepared.info.sessionID
    SyncEvent.run(
      SessionSync.MessageUpdated,
      {
        sessionID,
        info: input.prepared.info,
        promptData: input.promptData,
      },
      { projectID: input.projectID },
    )
    for (const part of input.prepared.parts) {
      SyncEvent.run(SessionSync.PartUpdated, { sessionID, part }, { projectID: input.projectID })
    }
  }
}
