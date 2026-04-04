use std::ffi::c_void;

/// Callback function pointer type for webview events.
pub type WrEventCallback = extern "C" fn(event: *const WrEvent, user_data: *mut c_void);

/// Event types emitted by the webview.
#[repr(u8)]
pub enum WrEventType {
    StateChange = 0,
    ScreenshotReady = 1,
    Navigation = 2,
    TitleChange = 3,
    IpcMessage = 4,
    Error = 5,
}

/// Event structure passed to the callback.
#[repr(C)]
pub struct WrEvent {
    pub event_type: u8,
    pub data: *const u8,
    pub data_len: usize,
}

impl WrEvent {
    pub fn new(event_type: WrEventType, json_data: &[u8]) -> Self {
        let mut vec = json_data.to_vec();
        let ptr = vec.as_mut_ptr();
        let len = vec.len();
        std::mem::forget(vec);
        WrEvent {
            event_type: event_type as u8,
            data: ptr,
            data_len: len,
        }
    }
}

/// Buffer containing raw pixel data returned by screenshot capture.
#[repr(C)]
pub struct WrBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub width: u32,
    pub height: u32,
}

impl WrBuffer {
    pub fn new(pixels: Vec<u8>, width: u32, height: u32) -> Self {
        let mut vec = pixels;
        let ptr = vec.as_mut_ptr();
        let len = vec.len();
        std::mem::forget(vec);
        WrBuffer {
            data: ptr,
            len,
            width,
            height,
        }
    }

    pub unsafe fn free(self) {
        if !self.data.is_null() && self.len > 0 {
            drop(Vec::from_raw_parts(self.data, self.len, self.len));
        }
    }
}

/// Modifier key bitmask for input events.
pub const MODIFIER_SHIFT: u8 = 1 << 0;
pub const MODIFIER_CTRL: u8 = 1 << 1;
pub const MODIFIER_ALT: u8 = 1 << 2;
pub const MODIFIER_META: u8 = 1 << 3;

/// Mouse button codes.
pub const MOUSE_LEFT: u8 = 0;
pub const MOUSE_MIDDLE: u8 = 1;
pub const MOUSE_RIGHT: u8 = 2;
