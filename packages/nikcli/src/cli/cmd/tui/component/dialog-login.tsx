import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { DialogContext } from "@tui/ui/dialog"
import { UserDB } from "@/db/users"

/**
 * Sequential login/register flow via TUI dialog prompts.
 * Returns the authenticated PublicUser or null if the user cancels.
 */
export const DialogLogin = {
  async run(dialog: DialogContext): Promise<UserDB.PublicUser | null> {
    const hasUsers = UserDB.hasUsers()

    if (!hasUsers) {
      // Registration flow — first user becomes admin
      const username = await DialogPrompt.show(dialog, "Create nikcli account — Username", {
        placeholder: "Enter a username (min 2 chars)",
      })
      if (!username || username.trim().length < 2) return null

      const email = await DialogPrompt.show(dialog, "Create nikcli account — Email", {
        placeholder: "Enter your email address",
      })
      if (!email || !email.includes("@")) return null

      const password = await DialogPrompt.show(dialog, "Create nikcli account — Password", {
        placeholder: "Enter a password (min 8 chars)",
      })
      if (!password || password.trim().length < 8) return null

      try {
        const user = await UserDB.create({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          password,
        })
        const token = UserDB.createSession(user.id, 30)
        await UserDB.saveActiveSession(token)
        dialog.clear()
        return user
      } catch (err: any) {
        await DialogPrompt.show(
          dialog,
          `Registration failed: ${err?.message ?? "Unknown error"}. Press Enter to retry.`,
          {
            placeholder: "Press Enter",
          },
        )
        return DialogLogin.run(dialog)
      }
    } else {
      // Login flow
      const email = await DialogPrompt.show(dialog, "Sign in to nikcli — Email", {
        placeholder: "Enter your email address",
      })
      if (!email) return null

      const password = await DialogPrompt.show(dialog, "Sign in to nikcli — Password", {
        placeholder: "Enter your password",
      })
      if (password === null) return null

      const userRecord = UserDB.findByEmail(email.trim().toLowerCase())
      if (!userRecord) {
        await DialogPrompt.show(dialog, "No account found with that email. Press Enter to retry.", {
          placeholder: "Press Enter",
        })
        return DialogLogin.run(dialog)
      }

      const valid = await UserDB.verifyPassword(userRecord, password)
      if (!valid) {
        await DialogPrompt.show(dialog, "Incorrect password. Press Enter to retry.", {
          placeholder: "Press Enter",
        })
        return DialogLogin.run(dialog)
      }

      const token = UserDB.createSession(userRecord.id, 30)
      await UserDB.saveActiveSession(token)
      dialog.clear()
      return UserDB.toPublic(userRecord)
    }
  },
}
