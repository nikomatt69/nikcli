import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
  on,
  batch,
} from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type TextareaRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { UserDB } from "@/db/users"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"

export function DialogChat() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  onMount(() => dialog.setSize("xlarge"))

  const me = createMemo(() => {
    const token = UserDB.getActiveSessionSync()
    if (!token) return null
    return UserDB.verifySession(token)
  })

  const [contacts, setContacts] = createSignal<UserDB.PublicUser[]>([])
  const [contactIdx, setContactIdx] = createSignal(0)
  const [messages, setMessages] = createSignal<UserDB.ChatMessage[]>([])
  const [panel, setPanel] = createSignal<"contacts" | "messages">("contacts")
  const [unreadCounts, setUnreadCounts] = createSignal<Record<string, number>>({})

  const selectedContact = createMemo(() => contacts()[contactIdx()] ?? null)

  let scroll: ScrollBoxRenderable | undefined
  let textarea: TextareaRenderable | undefined

  function refreshContacts() {
    const user = me()
    if (!user) return
    const cs = UserDB.listContacts(user.id)
    setContacts(cs)
    const counts: Record<string, number> = {}
    for (const c of cs) {
      counts[c.id] = UserDB.getUnreadCount(user.id, c.id)
    }
    setUnreadCounts(counts)
  }

  function refreshMessages() {
    const user = me()
    const contact = selectedContact()
    if (!user || !contact) {
      setMessages([])
      return
    }
    setMessages(UserDB.getMessages(user.id, contact.id))
    UserDB.markMessagesRead(user.id, contact.id)
    setUnreadCounts((prev) => ({ ...prev, [contact.id]: 0 }))
  }

  onMount(() => {
    refreshContacts()
    const interval = setInterval(() => {
      refreshContacts()
      if (panel() === "messages") refreshMessages()
    }, 2000)
    onCleanup(() => clearInterval(interval))
  })

  // Auto-scroll to bottom when new messages arrive
  createEffect(
    on(
      () => messages().length,
      () => {
        setTimeout(() => {
          if (scroll && !scroll.isDestroyed) scroll.scrollTo(scroll.scrollHeight)
        }, 10)
      },
    ),
  )

  // Focus textarea and scroll when switching to messages panel
  createEffect(
    on(
      () => panel(),
      (p) => {
        if (p === "messages") {
          setTimeout(() => {
            textarea?.focus()
            if (scroll && !scroll.isDestroyed) scroll.scrollTo(scroll.scrollHeight)
          }, 10)
        }
      },
    ),
  )

  function openMessages() {
    const contact = selectedContact()
    if (!contact) return
    setPanel("messages")
    refreshMessages()
  }

  function sendMessage(text: string) {
    const user = me()
    const contact = selectedContact()
    if (!user || !contact || !text.trim()) return
    UserDB.sendMessage(user.id, contact.id, text.trim())
    refreshMessages()
  }

  async function addContact() {
    const user = me()
    if (!user) return
    const query = await DialogPrompt.show(dialog, "Add Contact", {
      placeholder: "Enter username or email to search",
    })
    if (!query?.trim()) {
      dialog.replace(() => <DialogChat />)
      return
    }
    const found = UserDB.searchUsers(query.trim(), user.id)
    if (found.length === 0) {
      await DialogPrompt.show(dialog, "No user found. Press Enter to go back.", {
        placeholder: "Press Enter",
      })
      dialog.replace(() => <DialogChat />)
      return
    }
    if (found.length === 1) {
      UserDB.addContact(user.id, found[0].id)
      dialog.replace(() => <DialogChat />)
      return
    }
    // Multiple results — let user pick
    dialog.replace(() => (
      <DialogSelect
        title="Select contact to add"
        options={found.map((u) => ({
          title: u.display_name ?? u.username,
          description: u.email,
          value: u.id,
          onSelect: () => {
            UserDB.addContact(user.id, u.id)
            dialog.replace(() => <DialogChat />)
          },
        }))}
      />
    ))
  }

  function removeSelectedContact() {
    const user = me()
    const contact = selectedContact()
    if (!user || !contact) return
    UserDB.removeContact(user.id, contact.id)
    batch(() => {
      setContactIdx(0)
      setPanel("contacts")
    })
    refreshContacts()
  }

  useKeyboard((evt) => {
    if (panel() === "contacts") {
      if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
        setContactIdx((i) => Math.max(0, i - 1))
        evt.preventDefault()
        return
      }
      if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
        setContactIdx((i) => Math.min(contacts().length - 1, i + 1))
        evt.preventDefault()
        return
      }
      if (evt.name === "return") {
        if (selectedContact()) {
          openMessages()
          evt.preventDefault()
        }
        return
      }
      if (evt.name === "a") {
        addContact().catch(() => {})
        evt.preventDefault()
        return
      }
      if (evt.name === "d" && selectedContact()) {
        removeSelectedContact()
        evt.preventDefault()
        return
      }
    }
    if (panel() === "messages") {
      // ctrl+b goes back to contacts list
      if (evt.ctrl && evt.name === "b") {
        setPanel("contacts")
        textarea?.blur()
        evt.preventDefault()
        evt.stopPropagation()
      }
    }
  })

  const msgAreaHeight = createMemo(() => Math.max(6, Math.min(18, dimensions().height - 18)))

  const displayName = (u: UserDB.PublicUser) => u.display_name ?? u.username

  return (
    <box gap={1} paddingBottom={1}>
      {/* Header */}
      <box paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Chat
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
      </box>

      {/* Main area: contacts left + messages right */}
      <box flexDirection="row">
        {/* Contacts panel */}
        <box width={26} paddingRight={1}>
          <box paddingLeft={2} paddingBottom={1}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              Contacts
            </text>
          </box>
          <Show
            when={contacts().length > 0}
            fallback={
              <box paddingLeft={2} gap={1}>
                <text fg={theme.textMuted}>No contacts yet</text>
                <text fg={theme.textMuted}>
                  <span style={{ fg: theme.primary }}>a</span> add contact
                </text>
              </box>
            }
          >
            <scrollbox maxHeight={msgAreaHeight() + 7} scrollbarOptions={{ visible: false }}>
              <For each={contacts()}>
                {(contact, idx) => {
                  const active = createMemo(() => idx() === contactIdx())
                  const unread = createMemo(() => unreadCounts()[contact.id] ?? 0)
                  return (
                    <box
                      flexDirection="row"
                      paddingLeft={active() ? 1 : 2}
                      paddingRight={1}
                      backgroundColor={active() ? theme.primary : undefined}
                      onMouseUp={() => {
                        batch(() => setContactIdx(idx()))
                        openMessages()
                      }}
                      onMouseOver={() => setContactIdx(idx())}
                    >
                      <text
                        flexGrow={1}
                        fg={active() ? undefined : theme.text}
                        attributes={active() ? TextAttributes.BOLD : undefined}
                        overflow="hidden"
                        wrapMode="none"
                      >
                        {active() ? "● " : "  "}
                        {displayName(contact)}
                      </text>
                      <Show when={unread() > 0}>
                        <text fg={active() ? undefined : theme.accent} attributes={TextAttributes.BOLD}>
                          {unread()}
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </scrollbox>
          </Show>
        </box>

        {/* Divider */}
        <box width={1} backgroundColor={theme.border} />

        {/* Messages panel */}
        <box flexGrow={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show
            when={selectedContact()}
            fallback={
              <box flexGrow={1} alignItems="center" justifyContent="center" paddingTop={4}>
                <text fg={theme.textMuted}>Select a contact to chat</text>
              </box>
            }
          >
            {(contact) => (
              <box gap={1}>
                {/* Contact header */}
                <box flexDirection="row" gap={2} paddingBottom={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {displayName(contact())}
                  </text>
                  <text fg={theme.textMuted}>{contact().email}</text>
                </box>

                {/* Messages */}
                <scrollbox
                  maxHeight={msgAreaHeight()}
                  scrollbarOptions={{ visible: false }}
                  ref={(r: ScrollBoxRenderable) => {
                    scroll = r
                  }}
                >
                  <Show when={messages().length === 0}>
                    <text fg={theme.textMuted}>No messages yet. Say hello!</text>
                  </Show>
                  <For each={messages()}>
                    {(msg) => {
                      const isMine = me()?.id === msg.sender_id
                      const time = new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                      return (
                        <box paddingBottom={1}>
                          <box flexDirection="row" gap={1}>
                            <text
                              fg={isMine ? theme.primary : theme.accent}
                              attributes={TextAttributes.BOLD}
                            >
                              {isMine ? "You" : displayName(contact())}
                            </text>
                            <text fg={theme.textMuted}>{time}</text>
                          </box>
                          <text fg={theme.text} wrapMode="word">
                            {msg.content}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </scrollbox>

                {/* Input */}
                <box paddingTop={1} gap={1}>
                  <textarea
                    height={3}
                    keyBindings={[{ name: "return", action: "submit" }]}
                    onSubmit={() => {
                      const text = textarea?.plainText ?? ""
                      if (text.trim()) {
                        sendMessage(text)
                        textarea?.clear()
                      }
                    }}
                    ref={(r: TextareaRenderable) => {
                      textarea = r
                    }}
                    placeholder="Type a message, Enter to send"
                    textColor={theme.text}
                    focusedTextColor={theme.text}
                    cursorColor={theme.text}
                  />
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.primary }}>ctrl+b</span> contacts ·{" "}
                    <span style={{ fg: theme.primary }}>esc</span> close
                  </text>
                </box>
              </box>
            )}
          </Show>
        </box>
      </box>

      {/* Footer */}
      <Show when={panel() === "contacts"}>
        <box paddingLeft={2} paddingRight={2} flexDirection="row" gap={3}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.primary }}>a</span> add ·{" "}
            <span style={{ fg: theme.primary }}>d</span> remove ·{" "}
            <span style={{ fg: theme.primary }}>enter</span> open ·{" "}
            <span style={{ fg: theme.primary }}>esc</span> close
          </text>
        </box>
      </Show>
    </box>
  )
}
