use crate::types::{MODIFIER_ALT, MODIFIER_CTRL, MODIFIER_META, MODIFIER_SHIFT};

/// Map OpenTUI key names to DOM key names.
pub fn opentui_key_to_dom(name: &str) -> &str {
    match name {
        "return" | "enter" => "Enter",
        "escape" => "Escape",
        "backspace" => "Backspace",
        "delete" => "Delete",
        "tab" => "Tab",
        "up" => "ArrowUp",
        "down" => "ArrowDown",
        "left" => "ArrowLeft",
        "right" => "ArrowRight",
        "home" => "Home",
        "end" => "End",
        "pageup" => "PageUp",
        "pagedown" => "PageDown",
        "insert" => "Insert",
        "space" => "Space",
        s if s.starts_with('f') && s[1..].chars().all(|c| c.is_ascii_digit()) => {
            // f1, f2, ..., f12
            match s {
                "f1" => "F1",
                "f2" => "F2",
                "f3" => "F3",
                "f4" => "F4",
                "f5" => "F5",
                "f6" => "F6",
                "f7" => "F7",
                "f8" => "F8",
                "f9" => "F9",
                "f10" => "F10",
                "f11" => "F11",
                "f12" => "F12",
                _ => s,
            }
        }
        s => s,
    }
}

/// Build a modifier bitmask from boolean flags.
pub fn build_modifiers(shift: bool, ctrl: bool, alt: bool, meta: bool) -> u8 {
    let mut mods = 0u8;
    if shift {
        mods |= MODIFIER_SHIFT;
    }
    if ctrl {
        mods |= MODIFIER_CTRL;
    }
    if alt {
        mods |= MODIFIER_ALT;
    }
    if meta {
        mods |= MODIFIER_META;
    }
    mods
}
