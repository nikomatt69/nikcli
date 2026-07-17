import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { DialogContext } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { UserDB } from "@/user/users"
import { DialogAccountLogin } from "@tui/component/dialog-account-login"

type LoginChoice = "oauth" | "local"

function choose(dialog: DialogContext, hasUsers: boolean): Promise<LoginChoice | null> {
  return new Promise((resolve) => {
    dialog.replace(
      () => (
        <DialogSelect
          title="Sign in to nikcli"
          options={[
            {
              title: "Continue with nikcli",
              value: "oauth" as LoginChoice,
              description: "Sign in through your browser with GitHub or an email code.",
            },
            {
              title: hasUsers ? "Use a local password" : "Create a local account",
              value: "local" as LoginChoice,
              description: hasUsers
                ? "Legacy sign-in against this machine's local account."
                : "Offline fallback — a password-based account stored on this machine.",
            },
          ]}
          onSelect={(option) => resolve(option.value)}
        />
      ),
      () => resolve(null),
    )
  })
}

function oauthLogin(dialog: DialogContext): Promise<UserDB.PublicUser | null> {
  return new Promise((resolve) => {
    dialog.replace(
      () => <DialogAccountLogin onComplete={resolve} />,
      () => resolve(null),
    )
  })
}

/**
 * Startup sign-in flow. OAuth (device code against auth.nikcli.store) is the
 * primary path — it links the identity to the local user database so the TUI
 * session works exactly as before. The password flow remains as the offline
 * fallback for self-hosted machines.
 * Returns the authenticated PublicUser or null if the user cancels.
 */
export const DialogLogin = {
  async run(dialog: DialogContext): Promise<UserDB.PublicUser | null> {
    const hasUsers = UserDB.hasUsers()
    const choice = await choose(dialog, hasUsers)
    if (choice === null) return null
    if (choice === "oauth") {
      const user = await oauthLogin(dialog)
      if (user) return user
      // Cancelled or failed — back to the chooser rather than dead-ending.
      return DialogLogin.run(dialog)
    }
    return DialogLogin.runLocal(dialog)
  },

  async runLocal(dialog: DialogContext): Promise<UserDB.PublicUser | null> {
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
        return DialogLogin.runLocal(dialog)
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
        return DialogLogin.runLocal(dialog)
      }

      const valid = await UserDB.verifyPassword(userRecord, password)
      if (!valid) {
        await DialogPrompt.show(dialog, "Incorrect password. Press Enter to retry.", {
          placeholder: "Press Enter",
        })
        return DialogLogin.runLocal(dialog)
      }

      const token = UserDB.createSession(userRecord.id, 30)
      await UserDB.saveActiveSession(token)
      dialog.clear()
      return UserDB.toPublic(userRecord)
    }
  },
}
