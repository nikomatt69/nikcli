import { createMemo, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogProvider } from "./dialog-provider"
import { UserDB } from "@/db/users"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

export function DialogAuthManage() {
  const dialog = useDialog()
  const { theme } = useTheme()

  const currentUser = createMemo(() => {
    const token = UserDB.getActiveSessionSync()
    if (!token) return null
    return UserDB.verifySession(token)
  })

  const options = createMemo<DialogSelectOption[]>(() => {
    const user = currentUser()
    const items: DialogSelectOption[] = []

    if (user) {
      items.push(
        {
          title: "View Profile",
          value: "profile",
          category: "Account",
          onSelect: () => showProfile(dialog, user),
        },
        {
          title: "Change Display Name",
          value: "update_name",
          category: "Account",
          onSelect: () => updateDisplayName(dialog, user.id, user.display_name),
        },
        {
          title: "Change Password",
          value: "update_password",
          category: "Account",
          onSelect: () => updatePassword(dialog, user.id),
        },
        {
          title: "Logout",
          value: "logout",
          category: "Account",
          onSelect: () => logout(dialog),
        },
      )
    } else {
      items.push({
        title: "Login / Register",
        value: "login",
        category: "Account",
        onSelect: () => loginOrRegister(dialog),
      })
    }

    items.push({
      title: "Connect Provider",
      value: "connect_provider",
      category: "System",
      onSelect: () => dialog.replace(() => <DialogProvider />),
    })

    return items
  })

  return <DialogSelect title="Account" options={options()} />
}

async function showProfile(dialog: ReturnType<typeof useDialog>, user: UserDB.PublicUser) {
  const created = new Date(user.created_at).toLocaleDateString()
  const role = user.role === "admin" ? "Administrator" : "User"
  dialog.replace(() => {
    const { theme } = useTheme()
    return (
      <box paddingLeft={2} paddingRight={2} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>Profile</text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box gap={1} paddingTop={1}>
          <text fg={theme.text}><span style={{ fg: theme.textMuted }}>Username:</span> {user.username}</text>
          <Show when={user.display_name}>
            <text fg={theme.text}><span style={{ fg: theme.textMuted }}>Display:</span> {user.display_name}</text>
          </Show>
          <text fg={theme.text}><span style={{ fg: theme.textMuted }}>Email:</span> {user.email}</text>
          <text fg={theme.text}><span style={{ fg: theme.textMuted }}>Role:</span> {role}</text>
          <text fg={theme.text}><span style={{ fg: theme.textMuted }}>Joined:</span> {created}</text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.text}>enter <span style={{ fg: theme.textMuted }}>back</span></text>
        </box>
      </box>
    )
  })
}

async function updateDisplayName(dialog: ReturnType<typeof useDialog>, userId: string, currentName: string | null) {
  const value = await DialogPrompt.show(dialog, "Change Display Name", {
    placeholder: "Enter display name (leave empty to remove)",
    value: currentName ?? "",
  })
  if (value === null) return

  await UserDB.updateUser(userId, { displayName: value })
  dialog.replace(() => <DialogAuthManage />)
}

async function updatePassword(dialog: ReturnType<typeof useDialog>, userId: string) {
  const current = await DialogPrompt.show(dialog, "Change Password — Current", {
    placeholder: "Enter current password",
  })
  if (current === null) return

  const user = UserDB.findById(userId)
  if (!user) return

  const valid = await UserDB.verifyPassword(user, current)
  if (!valid) {
    await DialogPrompt.show(dialog, "Incorrect password. Press Enter to retry.", { placeholder: "Press Enter" })
    return updatePassword(dialog, userId)
  }

  const newPass = await DialogPrompt.show(dialog, "Change Password — New", {
    placeholder: "Enter new password (min 8 chars)",
  })
  if (newPass === null) return

  if (newPass.length < 8) {
    await DialogPrompt.show(dialog, "Password too short. Press Enter to retry.", { placeholder: "Press Enter" })
    return updatePassword(dialog, userId)
  }

  const confirm = await DialogPrompt.show(dialog, "Change Password — Confirm", {
    placeholder: "Confirm new password",
  })
  if (confirm === null) return

  if (newPass !== confirm) {
    await DialogPrompt.show(dialog, "Passwords do not match. Press Enter to retry.", { placeholder: "Press Enter" })
    return updatePassword(dialog, userId)
  }

  await UserDB.updateUser(userId, { password: newPass })
  dialog.replace(() => <DialogAuthManage />)
}

async function logout(dialog: ReturnType<typeof useDialog>) {
  const token = UserDB.getActiveSessionSync()
  if (token) {
    UserDB.revokeSession(token)
    await UserDB.clearActiveSession()
  }
  dialog.replace(() => <DialogAuthManage />)
}

async function loginOrRegister(dialog: ReturnType<typeof useDialog>) {
  const hasUsers = UserDB.hasUsers()

  if (!hasUsers) {
    const username = await DialogPrompt.show(dialog, "Create nikcli account — Username", {
      placeholder: "Enter a username (min 2 chars)",
    })
    if (!username || username.trim().length < 2) return

    const email = await DialogPrompt.show(dialog, "Create nikcli account — Email", {
      placeholder: "Enter your email address",
    })
    if (!email || !email.includes("@")) return

    const password = await DialogPrompt.show(dialog, "Create nikcli account — Password", {
      placeholder: "Enter a password (min 8 chars)",
    })
    if (!password || password.trim().length < 8) return

    try {
      const user = await UserDB.create({
        username: username.trim(),
        email: email.trim().toLowerCase(),
        password,
      })
      const token = UserDB.createSession(user.id, 30)
      await UserDB.saveActiveSession(token)
      dialog.replace(() => <DialogAuthManage />)
    } catch (err: any) {
      await DialogPrompt.show(dialog, `Registration failed: ${err?.message ?? "Unknown error"}`, {
        placeholder: "Press Enter",
      })
    }
  } else {
    const email = await DialogPrompt.show(dialog, "Sign in to nikcli — Email", {
      placeholder: "Enter your email address",
    })
    if (!email) return

    const password = await DialogPrompt.show(dialog, "Sign in to nikcli — Password", {
      placeholder: "Enter your password",
    })
    if (password === null) return

    const userRecord = UserDB.findByEmail(email.trim().toLowerCase())
    if (!userRecord) {
      await DialogPrompt.show(dialog, "No account found. Press Enter to retry.", { placeholder: "Press Enter" })
      return loginOrRegister(dialog)
    }

    const valid = await UserDB.verifyPassword(userRecord, password)
    if (!valid) {
      await DialogPrompt.show(dialog, "Incorrect password. Press Enter to retry.", { placeholder: "Press Enter" })
      return loginOrRegister(dialog)
    }

    const token = UserDB.createSession(userRecord.id, 30)
    await UserDB.saveActiveSession(token)
    dialog.replace(() => <DialogAuthManage />)
  }
}
