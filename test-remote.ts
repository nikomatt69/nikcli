import { createRemoteServer } from "./packages/remote/src/index.ts"

async function run() {
  const { server, session } = await createRemoteServer({
    port: 8080,
    host: "0.0.0.0",
    enableTerminal: true,
  })
  console.log(`Access the terminal at: ${session.qrUrl}`)
}

run()
