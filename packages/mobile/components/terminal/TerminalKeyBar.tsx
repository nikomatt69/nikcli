import { useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TERMINAL_DOCKED_KEYS } from "@/lib/terminal-keys"
import { TerminalKeyStrip, TerminalKeyStripContainer } from "@/components/terminal/TerminalKeyStrip"

type Props = {
  disabled?: boolean
  ctrlActive?: boolean
  shiftActive?: boolean
  onToggleModifiers?(next: { ctrl: boolean; shift: boolean }): void
  onFocusTerminal(): void
  onSendInput(data: string): void
}

/** Approximate docked key bar height for layout math (strip + safe area). */
export const TERMINAL_KEYBAR_DOCK_HEIGHT = 52

export function TerminalKeyBar({
  disabled = false,
  ctrlActive: ctrlActiveProp,
  shiftActive: shiftActiveProp,
  onToggleModifiers,
  onFocusTerminal,
  onSendInput,
}: Props) {
  const insets = useSafeAreaInsets()
  const [localCtrl, setLocalCtrl] = useState(false)
  const [localShift, setLocalShift] = useState(false)
  const ctrlActive = ctrlActiveProp ?? localCtrl
  const shiftActive = shiftActiveProp ?? localShift

  const handleToggleModifiers = (next: { ctrl: boolean; shift: boolean }) => {
    if (onToggleModifiers) onToggleModifiers(next)
    else {
      setLocalCtrl(next.ctrl)
      setLocalShift(next.shift)
    }
  }

  return (
    <TerminalKeyStripContainer docked>
      <TerminalKeyStrip
        keys={TERMINAL_DOCKED_KEYS}
        disabled={disabled}
        ctrlActive={ctrlActive}
        shiftActive={shiftActive}
        onToggleModifiers={handleToggleModifiers}
        onFocusTerminal={onFocusTerminal}
        onSendInput={onSendInput}
      />
      <View style={{ height: Math.max(insets.bottom, 8) }} />
    </TerminalKeyStripContainer>
  )
}
