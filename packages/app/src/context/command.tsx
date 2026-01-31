import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface Command {
  id: string
  name: string
  shortcut?: string
  action: () => void
}

interface CommandContextValue {
  commands: () => Command[]
  isOpen: () => boolean
  open: () => void
  close: () => void
  registerCommand: (command: Command) => void
  executeCommand: (id: string) => void
}

const CommandContext = createContext<CommandContextValue>()

export function CommandProvider(props: { children: JSX.Element }) {
  const [commands, setCommands] = createSignal<Command[]>([])
  const [isOpen, setIsOpen] = createSignal(false)

  const open = () => setIsOpen(true)
  const close = () => setIsOpen(false)

  const registerCommand = (command: Command) => {
    setCommands((prev) => [...prev, command])
  }

  const executeCommand = (id: string) => {
    const command = commands().find((c) => c.id === id)
    if (command) {
      command.action()
    }
    close()
  }

  return (
    <CommandContext.Provider
      value={{
        commands,
        isOpen,
        open,
        close,
        registerCommand,
        executeCommand,
      }}
    >
      {props.children}
    </CommandContext.Provider>
  )
}

export function useCommand() {
  const context = useContext(CommandContext)
  if (!context) {
    throw new Error("useCommand must be used within CommandProvider")
  }
  return context
}
