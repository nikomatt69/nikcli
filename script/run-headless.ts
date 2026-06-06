import { App } from "@slack/bolt"

const [prompt, channel, thread_ts] = Bun.argv.slice(2)
const model = process.env.NIKCLI_MODEL ?? "minimax-coding-plan/MiniMax-M3"

if (!prompt?.trim()) {
  console.error("A non-empty prompt is required")
  process.exit(1)
}

const app = process.env.SLACK_BOT_TOKEN
  ? new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: "not-used-for-outbound-messages",
    })
  : undefined

async function postToSlack(text: string) {
  if (!app || !channel || !thread_ts) return
  try {
    await app.client.chat.postMessage({
      channel,
      thread_ts,
      text: text.slice(0, 39_000),
    })
  } catch (error) {
    console.error("Failed to post Slack update:", error)
  }
}

async function main() {
  try {
    console.log(`Running nikcli with model ${model}`)
    await postToSlack(`NikCLI GitHub Actions: task avviata con \`${model}\`.`)

    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "--cwd",
        "packages/nikcli",
        "--conditions=browser",
        "src/index.ts",
        "run",
        "--model",
        model,
        "--format",
        "default",
        prompt,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    if (exitCode !== 0) throw new Error(stderr.trim() || `nikcli exited with code ${exitCode}`)

    const summary = stdout.trim() || "Task completata senza output testuale."
    await postToSlack(`NikCLI GitHub Actions: task completata.\n\n${summary}`)
  } catch (error) {
    console.error("Error during execution:", error)
    await postToSlack(`NikCLI GitHub Actions: task fallita.\n\`${String(error)}\``)
    process.exit(1)
  }
}

await main()
