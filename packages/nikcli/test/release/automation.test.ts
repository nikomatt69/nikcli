import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "../../../..")

async function readRoot(relative: string) {
  return fs.readFile(path.join(root, relative), "utf8")
}

describe("release automation", () => {
  it("publishes production releases automatically from live-main", async () => {
    const workflow = await readRoot(".github/workflows/publish.yml")

    expect(workflow).toContain("workflow_call:")
    expect(workflow).toContain("./script/publish-start.ts")
    expect(workflow).toContain("!startsWith(github.event.head_commit.message, 'release: v')")
    expect(workflow).toContain("!startsWith(github.event.head_commit.message, 'chore: generate')")
    expect(workflow).toContain("[nikcli autofix]")
  })

  it("runs validation CI on live-main without self-mutating release loops", async () => {
    const testWorkflow = await readRoot(".github/workflows/test.yml")
    const typecheckWorkflow = await readRoot(".github/workflows/typecheck.yml")
    const generateWorkflow = await readRoot(".github/workflows/generate.yml")
    const publishWorkflow = await readRoot(".github/workflows/publish.yml")

    expect(testWorkflow).toContain("- live-main")
    expect(typecheckWorkflow).toContain("- live-main")
    expect(typecheckWorkflow).toContain("branches: [live-main]")
    expect(generateWorkflow).toContain("- live-main")
    expect(generateWorkflow).toContain("group: generate-${{ github.ref }}")
    expect(generateWorkflow).toContain("if: github.ref_name != 'live-main'")
    expect(generateWorkflow).toContain("Verify live-main generated output")
    expect(publishWorkflow).toContain("./script/generate.ts")
  })

  it("keeps non-critical scheduled automations from making CI noisy", async () => {
    const docsWorkflow = await readRoot(".github/workflows/docs-update.yml")
    const statsWorkflow = await readRoot(".github/workflows/stats.yml")
    const nixWorkflow = await readRoot(".github/workflows/update-nix-hashes.yml")

    expect(docsWorkflow).toContain("continue-on-error: true")
    expect(docsWorkflow).toContain("nikomatt69/nikcli/github@latest")
    expect(docsWorkflow).toContain("MINIMAX_API_KEY")
    expect(statsWorkflow).toContain("continue-on-error: true")
    expect(statsWorkflow).toContain("oven-sh/setup-bun@v2")
    expect(statsWorkflow).toContain("git pull --rebase --autostash")
    expect(nixWorkflow).toContain("continue-on-error: ${{ github.event_name != 'workflow_dispatch' }}")
    expect(nixWorkflow).toContain("timeout-minutes: 45")
  })

  it("keeps the automatic GitHub release path single-sourced", async () => {
    const createRelease = await readRoot(".github/workflows/nikcli-create-release.yml")
    const publishStart = await readRoot("script/publish-start.ts")

    expect(publishStart).toContain("gh release create v${Script.version}")
    expect(createRelease).toContain("workflow_dispatch:")
    expect(createRelease).not.toContain("tags:")
    expect(createRelease).not.toContain("- live-main")
  })

  it("builds release archives without platform metadata", async () => {
    const publishScript = await readRoot("packages/nikcli/script/publish.ts")
    const githubScript = await readRoot("script/release-github.ts")
    const manualWorkflow = await readRoot(".github/workflows/nikcli-create-release.yml")

    for (const source of [publishScript, githubScript, manualWorkflow]) {
      expect(source).toContain("COPYFILE_DISABLE")
      expect(source).toContain("--no-xattrs")
      expect(source).toContain("--exclude='._*'")
      expect(source).toContain("--exclude='.DS_Store'")
      expect(source).toContain("zip -X")
      expect(source).toContain("'*/._*'")
      expect(source).toContain("'*/.DS_Store'")
    }
  })

  it("uses v-prefixed release tags for installer downloads", async () => {
    const installer = await readRoot("install")

    expect(installer).toContain('release_tag="v${requested_version}"')
    expect(installer).toContain("releases/download/${release_tag}/$filename")
    expect(installer).toContain("releases/tag/${release_tag}")
    expect(installer).not.toContain("releases/download/${requested_version}/$filename")
  })

  it("does not bypass release safety checks or expose token output", async () => {
    const workflow = await readRoot(".github/workflows/publish.yml")
    const publishStart = await readRoot("script/publish-start.ts")

    expect(workflow).not.toContain("npm whoami >/dev/null")
    expect(publishStart).not.toContain("--force")
    expect(publishStart).not.toContain("--no-verify")
    expect(publishStart).not.toContain("--tags")
    expect(publishStart).toContain("git add -A")
    expect(publishStart).toContain("git fetch origin ${branch}")
    // The release script pushes the branch (with a rebase-and-retry loop for
    // non-fast-forward races) and the tag as two separate pushes.
    expect(publishStart).toContain("git push origin HEAD:${branch}")
    expect(publishStart).toContain("git tag v${Script.version}")
    expect(publishStart).toContain("git push origin v${Script.version}")
  })

  it("publishes homebrew formula to the correct tap repository with proper checksums", async () => {
    const registriesScript = await readRoot("packages/nikcli/script/publish-registries.ts")

    // Must push to nikomatt69/homebrew-tap (not sst/homebrew-tap)
    expect(registriesScript).toContain("nikomatt69/homebrew-tap")

    // Must compute SHA256 checksums for each platform
    expect(registriesScript).toContain("sha256")

    // Must reference the correct GitHub release URLs
    expect(registriesScript).toContain("github.com/nikomatt69/nikcli/releases/download")

    // Must cover all four platform combos
    expect(registriesScript).toContain("darwin-x64")
    expect(registriesScript).toContain("darwin-arm64")
    expect(registriesScript).toContain("linux-x64")
    expect(registriesScript).toContain("linux-arm64")

    // Must use the correct archive naming convention (zip for macOS, tar.gz for Linux)
    expect(registriesScript).toContain("darwin-arm64.zip")
    expect(registriesScript).toContain("darwin-x64.zip")
    expect(registriesScript).toContain("linux-x64.tar.gz")
    expect(registriesScript).toContain("linux-arm64.tar.gz")

    // Must commit with a version-tagged message
    expect(registriesScript).toContain("nikcli v${Script.version}")

    // Must NOT reference the old sst org
    expect(registriesScript).not.toContain("sst/homebrew-tap")
  })

  it("publish-complete downloads release archives before updating registries", async () => {
    const completeScript = await readRoot("script/publish-complete.ts")

    // Must download archives from the GitHub release
    expect(completeScript).toContain("gh release download")

    // Must download the archive patterns needed for the homebrew formula
    expect(completeScript).toContain("nikcli-ai-linux")
    expect(completeScript).toContain("nikcli-ai-darwin")

    // Must import the registries script
    expect(completeScript).toContain("publish-registries")
  })
})

describe("CI pipeline", () => {
  it("has the ci-pipeline orchestrator with validate, publish, autofix, and report-failure jobs", async () => {
    const pipeline = await readRoot(".github/workflows/ci-pipeline.yml")

    expect(pipeline).toContain("name: ci-pipeline")
    expect(pipeline).toContain("validate")
    expect(pipeline).toContain("publish")
    expect(pipeline).toContain("autofix")
    expect(pipeline).toContain("report-failure")
  })

  it("gates publish behind validate on live-main only", async () => {
    const pipeline = await readRoot(".github/workflows/ci-pipeline.yml")

    expect(pipeline).toContain("needs: validate")
    expect(pipeline).toContain("needs.validate.result == 'success'")
    expect(pipeline).toContain("refs/heads/live-main")
    expect(pipeline).toContain("nikomatt69/nikcli")
    expect(pipeline).toContain("secrets: inherit")
    expect(pipeline).toContain("!startsWith(github.event.head_commit.message, 'release: v')")
    expect(pipeline).toContain("!startsWith(github.event.head_commit.message, 'chore: generate')")
    expect(pipeline).toContain("!startsWith(github.event.head_commit.message, 'chore: update')")
    expect(pipeline).toContain("[nikcli autofix]")
  })

  it("autofix only runs on trusted contexts and skips bot/release/generated commits", async () => {
    const pipeline = await readRoot(".github/workflows/ci-pipeline.yml")

    expect(pipeline).toContain("needs.validate.result == 'failure'")
    expect(pipeline).toContain("github-actions[bot]")
    expect(pipeline).toContain("[nikcli autofix]")
    expect(pipeline).toContain("release: v")
    expect(pipeline).toContain("chore: generate")
  })

  it("publish.yml exposes workflow_call and does not publish on live-main push directly", async () => {
    const publish = await readRoot(".github/workflows/publish.yml")

    // Must have workflow_call for ci-pipeline to invoke it
    expect(publish).toContain("workflow_call:")

    // Must accept bump, version, and channel inputs via workflow_call
    expect(publish).toContain("bump:")
    expect(publish).toContain("version:")
    expect(publish).toContain("channel:")

    // Must NOT have live-main as a push trigger (only dev and snapshot-* remain)
    // Check that the push branches section does not contain live-main by extracting it
    const pushMatch = publish.match(/on:[\s\S]*?push:[\s\S]*?branches:[\s\S]*?(?=\n\s{0,2}\S|\n\s{0,2}workflow)/)
    if (pushMatch) {
      const pushBlock = pushMatch[0]
      // live-main should NOT appear in the push branches block
      const liveMainInPush = pushBlock.includes("live-main")
      expect(liveMainInPush).toBe(false)
    }
  })

  it("report-failure uses sticky marker and configurable mention, not raw logs", async () => {
    const pipeline = await readRoot(".github/workflows/ci-pipeline.yml")
    const script = await readRoot("script/ci-report-failure.ts")

    // Pipeline passes the mention env var
    expect(pipeline).toContain("NIKCLI_CI_FAILURE_MENTION")
    expect(pipeline).toContain("AUTOFIX_ATTEMPTED")

    // Script uses sticky marker for idempotent comments
    expect(script).toContain("<!-- nikcli-ci-autofix -->")

    // Script redacts tokens
    expect(script).toContain("[REDACTED]")

    // Script does NOT dump full env
    expect(script).not.toContain("process.env.NPM_TOKEN")
    expect(script).not.toContain("process.env.SST_GITHUB_TOKEN")

    // Pipeline does not print npm whoami output
    expect(pipeline).not.toContain("npm whoami\n")
  })

  it("ci-validate redacts token patterns from summaries", async () => {
    const script = await readRoot("script/ci-validate.ts")

    expect(script).toContain("[REDACTED]")
    // Must redact common token patterns
    expect(script).toContain("ghp_")
    expect(script).toContain("sk-")
    expect(script).toContain("npm_")
  })

  it("ci-autofix has anti-loop guards and trust checks", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    // Must check for bot actor
    expect(script).toContain("github-actions[bot]")
    expect(script).toContain("nikcli-ci[bot]")

    // Must check skip patterns
    expect(script).toContain("[nikcli autofix]")
    expect(script).toContain("release: v")
    expect(script).toContain("chore: generate")

    // Must check repository trust
    expect(script).toContain("nikomatt69/nikcli")

    // Must check for NIKCLI_API_KEY
    expect(script).toContain("NIKCLI_API_KEY")

    // Must not push without validation passing
    expect(script).toContain("revalidateExit")

    // Must signal distinct exit code for autofix failure
    expect(script).toContain("process.exit(78)")
  })
})
