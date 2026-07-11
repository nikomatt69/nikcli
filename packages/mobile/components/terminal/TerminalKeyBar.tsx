import { useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TERMINAL_DOCKED_KEYS } from "@/lib/terminal-keys"
import { TerminalKeyStrip, TerminalKeyStripContainer } from "@/components/terminal/TerminalKeyStrip"

type Props = {
  disabled?: boolean
  ctrlActive?: boolean
  shiftActive?: boolean
  keyboardVisible?: boolean
  onToggleModifiers?(next: { ctrl: boolean; shift: boolean }): void
  onFocusTerminal(): void
  onSendInput(data: string): void
  onHideKeyboard?(): void
}

/** Approximate docked key bar height for layout math (strip + bottom padding). */
export const TERMINAL_KEYBAR_DOCK_HEIGHT = 64

export function TerminalKeyBar({
  disabled = false,
  ctrlActive: ctrlActiveProp,
  shiftActive: shiftActiveProp,
  keyboardVisible = false,
  onToggleModifiers,
  onFocusTerminal,
  onSendInput,
  onHideKeyboard,
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

  // When the soft keyboard is open, the dock already has keyboardInset padding —
  // skip the home-indicator gap so the strip sits flush above the keyboard.
  const bottomPad = keyboardVisible ? 6 : Math.max(insets.bottom, 8)

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
        onHideKeyboard={onHideKeyboard}
      />
      <View style={{ height: bottomPad }} />
    </TerminalKeyStripContainer>
  )
}
