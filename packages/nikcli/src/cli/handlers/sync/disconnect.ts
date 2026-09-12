import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["disconnect"], async (_input) => {
  
  console.log("To end an active connection, stop the process that ran `nikcli sync connect` (e.g. Ctrl-C).")
  console.log("Queued events in the outbox are sent on the next connect.")
})
