import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { Clipboard } from "@tui/util/clipboard"
import { createMemo, For, onMount, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useToast } from "@tui/ui/toast"
import { DialogProvider } from "./dialog-provider"
import { UserDB } from "@/user/users"
import { useTheme } from "@tui/context/theme"

type ProfileNotice = {
  message: string
  tone: "info" | "success" | "warning"
}

export function DialogAuthManage() {
  const dialog = useDialog()

  const currentUser = createMemo(() => {
    const token = UserDB.getActiveSessionSync()
    if (!token) return null
    return UserDB.verifySession(token)
  })

  const options = createMemo<DialogSelectOption[]>(() => {
    const user = currentUser()
    const items: DialogSelectOption[] = []

    if (user) {
      const displayName = user.display_name?.trim()
      items.push(
        {
          title: "View Profile",
          value: "profile",
          category: "Account",
          description: displayName ? `${displayName} · ${user.email}` : user.email,
          footer: getRoleLabel(user.role),
          onSelect: () => showProfile(dialog, user),
        },
        {
          title: "Change Display Name",
          value: "update_name",
          category: "Account",
          description: displayName ? `Current: ${displayName}` : "Set the name shown in chat and account views",
          onSelect: async () => {
            await updateDisplayName(dialog, user.id, user.display_name)
            dialog.replace(() => <DialogAuthManage />)
          },
        },
        {
          title: "Change Password",
          value: "update_password",
          category: "Account",
          description: "Update the password stored for this local account",
          onSelect: async () => {
            await updatePassword(dialog, user.id)
            dialog.replace(() => <DialogAuthManage />)
          },
        },
        {
          title: "Logout",
          value: "logout",
          category: "Account",
          description: `Signed in as ${user.username}`,
          onSelect: async () => {
            await logout()
            dialog.replace(() => <DialogAuthManage />)
          },
        },
      )
    } else {
      items.push({
        title: "Login / Register",
        value: "login",
        category: "Account",
        description: "Create a local profile or sign in to an existing one",
        onSelect: async () => {
          await loginOrRegister(dialog)
          dialog.replace(() => <DialogAuthManage />)
        },
      })
    }

    items.push({
      title: "Connect Provider",
      value: "connect_provider",
      category: "System",
      description: "Manage model provider credentials and connection state",
      onSelect: () => dialog.replace(() => <DialogProvider />),
    })

    return items
  })

  return <DialogSelect title="Account" options={options()} />
}

function showProfile(dialog: DialogContext, user: UserDB.PublicUser, notice?: ProfileNotice) {
  dialog.replace(() => <DialogProfile user={user} notice={notice} />)
}

function DialogProfile(props: { user: UserDB.PublicUser; notice?: ProfileNotice }) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  onMount(() => dialog.setSize("large"))

  const displayName = createMemo(() => props.user.display_name?.trim() || props.user.username)
  const subtitle = createMemo(() => {
    if (props.user.display_name?.trim()) return `@${props.user.username} · local profile`
    return `@${props.user.username} · add a display name for a friendlier handle`
  })
  const stats = createMemo(() => ({
    contacts: UserDB.listContacts(props.user.id).length,
    unread: UserDB.getTotalUnreadCount(props.user.id),
    memberFor: formatRelativeAge(props.user.created_at),
  }))

  const restoreProfile = (notice?: ProfileNotice, nextUser?: UserDB.PublicUser | null) => {
    showProfile(dialog, nextUser ?? getCurrentUser(props.user.id) ?? props.user, notice)
  }

  const copyValue = async (value: string, label: string) => {
    await Clipboard.copy(value)
      .then(() => toast.show({ message: `${label} copied to clipboard`, variant: "info" }))
      .catch(toast.error)
  }

  const handleDisplayName = async () => {
    const updated = await updateDisplayName(dialog, props.user.id, props.user.display_name)
    restoreProfile(
      updated
        ? {
            tone: "success",
            message: updated.display_name ? "Display name updated." : "Display name cleared.",
          }
        : undefined,
      updated,
    )
  }

  const handlePassword = async () => {
    const changed = await updatePassword(dialog, props.user.id)
    restoreProfile(changed ? { tone: "success", message: "Password updated." } : undefined)
  }

  const handleLogout = async () => {
    await logout()
    dialog.replace(() => <DialogAuthManage />)
  }

  const actions = createMemo(() => [
    {
      shortcut: "n",
      title: "Edit display name",
      description: props.user.display_name?.trim() || "Add a public-facing label for chat and account views",
      tone: "accent" as const,
      onSelect: () => {
        void handleDisplayName()
      },
    },
    {
      shortcut: "p",
      title: "Change password",
      description: "Rotate the password stored for this local account",
      tone: "warning" as const,
      onSelect: () => {
        void handlePassword()
      },
    },
    {
      shortcut: "c",
      title: "Copy email",
      description: props.user.email,
      tone: "info" as const,
      onSelect: () => {
        void copyValue(props.user.email, "Email")
      },
    },
    {
      shortcut: "u",
      title: "Copy username",
      description: props.user.username,
      tone: "default" as const,
      onSelect: () => {
        void copyValue(props.user.username, "Username")
      },
    },
    {
      shortcut: "l",
      title: "Logout",
      description: "Sign out of this device and return to the account menu",
      tone: "error" as const,
      onSelect: () => {
        void handleLogout()
      },
    },
  ])

  useKeyboard((evt) => {
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      dialog.replace(() => <DialogAuthManage />)
      return
    }

    const action = actions().find((item) => item.shortcut === evt.name)
    if (!action) return
    evt.preventDefault()
    evt.stopPropagation()
    action.onSelect()
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Profile
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box
        backgroundColor={theme.backgroundElement}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <box flexDirection="row" justifyContent="space-between" gap={2}>
          <box gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {displayName()}
            </text>
            <text fg={theme.textMuted}>{subtitle()}</text>
          </box>
          <box backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1} alignSelf="flex-start">
            <text fg={props.user.role === "admin" ? theme.warning : theme.accent}>{getRoleLabel(props.user.role)}</text>
          </box>
        </box>
        <text fg={theme.text}>{props.user.email}</text>
        <Show
          when={props.user.display_name?.trim()}
          fallback={
            <text fg={theme.textMuted}>
              Set a display name to make your local identity easier to recognize in chat.
            </text>
          }
        >
          <text fg={theme.textMuted}>
            Your display name is already configured and shown wherever this profile appears.
          </text>
        </Show>
      </box>

      <Show when={props.notice}>{(notice) => <ProfileNoticeBox notice={notice()} />}</Show>

      <box flexDirection="row" gap={1}>
        <ProfileStat label="Contacts" value={String(stats().contacts)} tone="accent" />
        <ProfileStat label="Unread" value={String(stats().unread)} tone={stats().unread > 0 ? "warning" : "default"} />
        <ProfileStat label="Member For" value={stats().memberFor} tone="success" />
      </box>

      <box gap={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          Details
        </text>
        <box
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          gap={1}
        >
          <ProfileField label="Username" value={props.user.username} />
          <ProfileField label="Display" value={props.user.display_name?.trim() || "Not set"} />
          <ProfileField label="Email" value={props.user.email} />
          <ProfileField label="Role" value={getRoleLabel(props.user.role)} />
          <ProfileField label="Joined" value={formatDate(props.user.created_at)} />
          <ProfileField label="Updated" value={formatDate(props.user.updated_at)} />
        </box>
      </box>

      <box gap={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          Quick Actions
        </text>
        <box gap={1}>
          <For each={actions()}>{(action) => <ProfileActionRow {...action} />}</For>
        </box>
      </box>

      <text fg={theme.textMuted}>
        <span style={{ fg: theme.primary }}>enter</span> back to account menu ·{" "}
        <span style={{ fg: theme.primary }}>esc</span> close
      </text>
    </box>
  )
}

function ProfileNoticeBox(props: { notice: ProfileNotice }) {
  const { theme } = useTheme()

  const color = createMemo(() => {
    if (props.notice.tone === "success") return theme.success
    if (props.notice.tone === "warning") return theme.warning
    return theme.info
  })

  return (
    <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <text fg={color()}>{props.notice.message}</text>
    </box>
  )
}

function ProfileStat(props: { label: string; value: string; tone: "default" | "accent" | "warning" | "success" }) {
  const { theme } = useTheme()

  const color = createMemo(() => {
    if (props.tone === "accent") return theme.accent
    if (props.tone === "warning") return theme.warning
    if (props.tone === "success") return theme.success
    return theme.text
  })

  return (
    <box
      flexGrow={1}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box gap={0}>
        <text fg={theme.textMuted}>{props.label}</text>
        <text fg={color()} attributes={TextAttributes.BOLD}>
          {props.value}
        </text>
      </box>
    </box>
  )
}

function ProfileField(props: { label: string; value: string }) {
  const { theme } = useTheme()

  return (
    <box flexDirection="row" gap={2}>
      <box width={12} flexShrink={0}>
        <text fg={theme.textMuted}>{props.label}</text>
      </box>
      <text fg={theme.text} wrapMode="word">
        {props.value}
      </text>
    </box>
  )
}

function ProfileActionRow(props: {
  shortcut: string
  title: string
  description: string
  tone: "default" | "accent" | "info" | "warning" | "error"
  onSelect: () => void
}) {
  const { theme } = useTheme()

  const color = createMemo(() => {
    if (props.tone === "accent") return theme.accent
    if (props.tone === "info") return theme.info
    if (props.tone === "warning") return theme.warning
    if (props.tone === "error") return theme.error
    return theme.text
  })

  return (
    <box
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      onMouseUp={() => props.onSelect()}
    >
      <box gap={0}>
        <text fg={theme.text}>
          <span style={{ fg: color(), attributes: TextAttributes.BOLD }}>{props.shortcut}</span> {props.title}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {props.description}
        </text>
      </box>
    </box>
  )
}

async function updateDisplayName(dialog: DialogContext, userId: string, currentName: string | null) {
  const value = await DialogPrompt.show(dialog, "Change Display Name", {
    placeholder: "Enter display name (leave empty to remove)",
    value: currentName ?? "",
  })
  if (value === null) return

  return UserDB.updateUser(userId, { displayName: value })
}

async function updatePassword(dialog: DialogContext, userId: string): Promise<boolean> {
  const current = await DialogPrompt.show(dialog, "Change Password — Current", {
    placeholder: "Enter current password",
  })
  if (current === null) return false

  const user = UserDB.findById(userId)
  if (!user) return false

  const valid = await UserDB.verifyPassword(user, current)
  if (!valid) {
    const retry = await DialogPrompt.show(dialog, "Incorrect password. Press Enter to retry.", {
      placeholder: "Press Enter",
    })
    if (retry === null) return false
    return updatePassword(dialog, userId)
  }

  const newPass = await DialogPrompt.show(dialog, "Change Password — New", {
    placeholder: "Enter new password (min 8 chars)",
  })
  if (newPass === null) return false

  if (newPass.length < 8) {
    const retry = await DialogPrompt.show(dialog, "Password too short. Press Enter to retry.", {
      placeholder: "Press Enter",
    })
    if (retry === null) return false
    return updatePassword(dialog, userId)
  }

  const confirm = await DialogPrompt.show(dialog, "Change Password — Confirm", {
    placeholder: "Confirm new password",
  })
  if (confirm === null) return false

  if (newPass !== confirm) {
    const retry = await DialogPrompt.show(dialog, "Passwords do not match. Press Enter to retry.", {
      placeholder: "Press Enter",
    })
    if (retry === null) return false
    return updatePassword(dialog, userId)
  }

  await UserDB.updateUser(userId, { password: newPass })
  return true
}

async function logout() {
  const token = UserDB.getActiveSessionSync()
  if (token) {
    UserDB.revokeSession(token)
    await UserDB.clearActiveSession()
  }
}

async function loginOrRegister(dialog: DialogContext) {
  const hasUsers = UserDB.hasUsers()

  if (!hasUsers) {
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
      return user
    } catch (err: any) {
      await DialogPrompt.show(dialog, `Registration failed: ${err?.message ?? "Unknown error"}`, {
        placeholder: "Press Enter",
      })
      return null
    }
  } else {
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
      const retry = await DialogPrompt.show(dialog, "No account found. Press Enter to retry.", {
        placeholder: "Press Enter",
      })
      if (retry === null) return null
      return loginOrRegister(dialog)
    }

    const valid = await UserDB.verifyPassword(userRecord, password)
    if (!valid) {
      const retry = await DialogPrompt.show(dialog, "Incorrect password. Press Enter to retry.", {
        placeholder: "Press Enter",
      })
      if (retry === null) return null
      return loginOrRegister(dialog)
    }

    const token = UserDB.createSession(userRecord.id, 30)
    await UserDB.saveActiveSession(token)
    return UserDB.toPublic(userRecord)
  }
}

function getCurrentUser(userId: string) {
  const user = UserDB.findById(userId)
  return user ? UserDB.toPublic(user) : null
}

function getRoleLabel(role: UserDB.PublicUser["role"]) {
  return role === "admin" ? "Administrator" : "User"
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatRelativeAge(value: number) {
  const diff = Math.max(0, Date.now() - value)
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))

  if (days <= 0) return "Today"
  if (days < 30) return `${days}d`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`

  return `${Math.floor(days / 365)}y`
}
