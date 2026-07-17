import path from "path"
import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./artifact.txt"
import { Artifact } from "@/artifact"
import { Instance } from "@/project/instance"

const parameters = z.object({
  filePath: z.string().describe("Path to the file to publish (absolute, or relative to the project directory)"),
  title: z.string().describe("Artifact title shown in the viewer header and in artifact lists"),
  description: z.string().optional().describe("One-sentence description of the artifact (optional)"),
  artifactID: z
    .string()
    .optional()
    .describe("Existing artifact ID to update in place (publishes a new version at the same URL)"),
})

export const ArtifactTool = Tool.define("artifact", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)

    const contentType = Artifact.contentTypeFor(filepath)
    if (!contentType) {
      throw new Error(
        `Unsupported artifact file type: ${path.extname(filepath) || filepath}. ` +
          "Supported: .html, .htm, .md, .markdown, .txt, .png, .jpg, .jpeg, .gif, .webp, .svg, .mp4, .webm, .mov, .m4v",
      )
    }

    const file = Bun.file(filepath)
    if (!(await file.exists())) throw new Error(`File not found: ${filepath}`)
    if (file.size > Artifact.MAX_BYTES) {
      throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — artifacts are limited to 25MB`)
    }

    await ctx.ask({
      permission: "artifact",
      patterns: [filepath],
      always: ["*"],
      metadata: {
        title: params.title,
        filePath: filepath,
        contentType,
        update: params.artifactID,
      },
    })

    const content = new Uint8Array(await file.arrayBuffer())
    const info = await Artifact.publish({
      sessionID: ctx.sessionID,
      title: params.title,
      description: params.description,
      filename: path.basename(filepath),
      contentType,
      content,
      artifactID: params.artifactID,
    })

    const lines = [
      `Published "${info.title}" (${info.kind}, v${info.version})`,
      // The ?key= capability link opens without a store login; the bare URL
      // is the login-gated page for the owner's account.
      Artifact.viewerUrl(info),
      params.artifactID ? "Updated in place — anyone with the page open sees the new version." : undefined,
      `To update this artifact later, call the artifact tool with artifactID: ${info.id}`,
    ].filter(Boolean)

    return {
      title: info.title,
      output: lines.join("\n"),
      metadata: {
        id: info.id,
        title: info.title,
        description: info.description,
        filename: info.filename,
        contentType: info.contentType,
        url: info.url,
        viewerUrl: Artifact.viewerUrl(info),
        previewUrl: Artifact.previewUrl(info),
        kind: info.kind,
        version: info.version,
        size: info.size,
      },
    }
  },
})
