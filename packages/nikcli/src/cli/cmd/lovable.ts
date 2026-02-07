import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import open from "open"
import { cmd } from "./cmd"
import { UI } from "../ui"

const LOVABLE_BASE_URL = "https://lovable.dev/"
const LOVABLE_PROMPT_MAX = 50000
const LOVABLE_IMAGES_MAX = 10

function buildUrl(prompt: string, images: string[]) {
  const url = new URL(LOVABLE_BASE_URL)
  url.searchParams.set("autosubmit", "true")
  const params = new URLSearchParams()
  params.set("prompt", prompt)
  for (const image of images) {
    params.append("images", image)
  }
  url.hash = params.toString()
  return url.toString()
}

function toArray(value: string[] | string | undefined) {
  if (Array.isArray(value)) return value
  if (typeof value === "string") return [value]
  return []
}

function normalizeImages(images: string[]) {
  return images.map((item) => item.trim()).filter((item) => item.length > 0)
}

function findInvalidImage(images: string[]) {
  return images.find((item) => !item.startsWith("http://") && !item.startsWith("https://"))
}

export const LovableCommand = cmd({
  command: "lovable",
  describe: "build Lovable apps from your terminal",
  builder: (yargs) => yargs.command(LovableBuildCommand).demandCommand(),
  async handler() {},
})

export const LovableBuildCommand = cmd({
  command: "build",
  describe: "build a Lovable app using Build with URL",
  builder: (yargs: Argv) =>
    yargs
      .option("prompt", {
        type: "string",
        describe: "app prompt",
      })
      .option("image", {
        type: "string",
        describe: "reference image URL (repeatable)",
        array: true,
      })
      .option("open", {
        type: "boolean",
        describe: "open the build URL in your browser",
        default: true,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Lovable Build")

    const promptInput =
      typeof args.prompt === "string"
        ? args.prompt
        : await prompts.text({
            message: "Describe the app to build",
            validate: (input) => {
              if (!input || input.trim().length === 0) return "Required"
              if (input.length > LOVABLE_PROMPT_MAX) return `Max ${LOVABLE_PROMPT_MAX} characters`
              return undefined
            },
          })

    if (prompts.isCancel(promptInput)) throw new UI.CancelledError()

    const prompt = promptInput.trim()
    if (!prompt) {
      prompts.log.error("Prompt is required")
      prompts.outro("Done")
      return
    }
    if (prompt.length > LOVABLE_PROMPT_MAX) {
      prompts.log.error(`Prompt exceeds ${LOVABLE_PROMPT_MAX} characters`)
      prompts.outro("Done")
      return
    }

    const images = normalizeImages(toArray(args.image))
    if (images.length > LOVABLE_IMAGES_MAX) {
      prompts.log.error(`Use up to ${LOVABLE_IMAGES_MAX} image URLs`)
      prompts.outro("Done")
      return
    }
    const invalid = findInvalidImage(images)
    if (invalid) {
      prompts.log.error(`Invalid image URL: ${invalid}`)
      prompts.outro("Done")
      return
    }

    const url = buildUrl(prompt, images)
    prompts.log.warn("Do not paste API keys in the prompt. Use Lovable secrets for credentials.")
    prompts.log.info("Build URL:")
    prompts.log.info(url)
    prompts.log.info("If you are not logged in, Lovable will ask you to sign in and choose a workspace.")

    if (!args.open) {
      prompts.outro("Done")
      return
    }

    const opened = await open(url)
      .then(() => true)
      .catch(() => false)

    if (!opened) {
      prompts.log.warn("Could not open the browser. Open this URL manually:")
      prompts.log.info(url)
    }

    prompts.outro("Done")
  },
})
