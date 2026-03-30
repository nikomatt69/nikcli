import type { Plugin } from "@nikcli-ai/plugin"

/**
 * Smart Title
 *
 * Automatically generates a short, meaningful title for a session based on
 * the first user message. Fires once per session and never re-generates.
 *
 * Options:
 *   maxWords         — max words in the generated title (default: 8)
 *   minMessageLength — ignore first messages shorter than this (default: 10)
 */
export const SmartTitlePlugin: Plugin = async (input, options) => {
  const { client } = input
  const maxWords = (options?.maxWords as number | undefined) ?? 8
  const minMessageLength = (options?.minMessageLength as number | undefined) ?? 10

  const titledSessions = new Set<string>()

  return {
    "chat.message": async (msgInput, msgOutput) => {
      const { sessionID } = msgInput
      if (titledSessions.has(sessionID)) return

      // Only process user messages (the parts array contains the user content)
      const textParts = msgOutput.parts.filter((p) => (p as any).type === "text")
      if (textParts.length === 0) return

      const userText = textParts
        .map((p) => (p as any).text as string)
        .join(" ")
        .trim()

      if (userText.length < minMessageLength) return

      // Mark as titled immediately to prevent duplicate runs
      titledSessions.add(sessionID)

      try {
        const snippet = userText.slice(0, 500)
        const titlePrompt = `Generate a concise title (maximum ${maxWords} words, no punctuation at end, no quotes) that summarises this task:\n\n${snippet}`

        const { data: newSession } = await client.session.create({
          body: { title: `smart-title-worker` },
        })
        if (!newSession) return

        const { data: promptResult } = await client.session.prompt({
          path: { id: newSession.id },
          body: {
            noReply: false,
            parts: [{ type: "text", text: titlePrompt }],
          },
        })

        if (!promptResult) {
          await client.session.delete({ path: { id: newSession.id } })
          return
        }

        // Extract text from the response parts
        const titleText = promptResult.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text as string)
          .join("")
          .trim()
          .replace(/^["']|["']$/g, "")
          .slice(0, 100)

        await client.session.delete({ path: { id: newSession.id } })

        if (titleText) {
          await client.session.update({
            path: { id: sessionID },
            body: { title: titleText },
          })
        }
      } catch {
        // Non-fatal: title generation failed, leave session untitled
        titledSessions.delete(sessionID)
      }
    },
  }
}

export default { server: SmartTitlePlugin }
