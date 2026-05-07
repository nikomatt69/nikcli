import { UI } from "../ui"
import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { withInstanceAsync } from "@/effect"
import { $ } from "bun"

export const PrCommand = cmd({
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR branch, then run nikcli",
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  async handler(args) {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        const prNumber = args.number
        const localBranchName = `pr/${prNumber}`
        UI.println(`Fetching and checking out PR #${prNumber}...`)

        const result = await $`gh pr checkout ${prNumber} --branch ${localBranchName} --force`.nothrow()

        if (result.exitCode !== 0) {
          UI.error(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
          process.exit(1)
        }

        const prInfoResult =
          await $`gh pr view ${prNumber} --json headRepository,headRepositoryOwner,isCrossRepository,headRefName,body`.nothrow()

        let sessionId: string | undefined

        if (prInfoResult.exitCode === 0) {
          const prInfoText = prInfoResult.text()
          if (prInfoText.trim()) {
            const prInfo = JSON.parse(prInfoText)

            if (prInfo && prInfo.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
              const forkOwner = prInfo.headRepositoryOwner.login
              const forkName = prInfo.headRepository.name
              const remoteName = forkOwner

              const remotes = (await $`git remote`.nothrow().text()).trim()
              if (!remotes.split("\n").includes(remoteName)) {
                await $`git remote add ${remoteName} https://github.com/${forkOwner}/${forkName}.git`.nothrow()
                UI.println(`Added fork remote: ${remoteName}`)
              }

              const headRefName = prInfo.headRefName
              await $`git branch --set-upstream-to=${remoteName}/${headRefName} ${localBranchName}`.nothrow()
            }

            if (prInfo && prInfo.body) {
              const sessionMatch = prInfo.body.match(/https:\/\/nikcli\.ai\/s\/([a-zA-Z0-9_-]+)/)
              if (sessionMatch) {
                const sessionUrl = sessionMatch[0]
                UI.println(`Found nikcli session: ${sessionUrl}`)
                UI.println(`Importing session...`)

                const importResult = await $`nikcli import ${sessionUrl}`.nothrow()
                if (importResult.exitCode === 0) {
                  const importOutput = importResult.text().trim()
                  const sessionIdMatch = importOutput.match(/Imported session: ([a-zA-Z0-9_-]+)/)
                  if (sessionIdMatch) {
                    sessionId = sessionIdMatch[1]
                    UI.println(`Session imported: ${sessionId}`)
                  }
                }
              }
            }
          }
        }

        UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)
        UI.println()
        UI.println("Starting nikcli...")
        UI.println()

        const { spawn } = await import("child_process")
        const nikcliArgs = sessionId ? ["-s", sessionId] : []
        const nikcliProcess = spawn("nikcli", nikcliArgs, {
          stdio: "inherit",
          cwd: process.cwd(),
        })

        await new Promise<void>((resolve, reject) => {
          nikcliProcess.on("exit", (code) => {
            if (code === 0) resolve()
            else reject(new Error(`nikcli exited with code ${code}`))
          })
          nikcliProcess.on("error", reject)
        })
      }
    })
  },
})
