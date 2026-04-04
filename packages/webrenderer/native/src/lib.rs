mod app;
mod image_proc;
mod input;
mod screenshot;
mod types;
mod webview;

use std::ffi::{c_char, CStr};
use std::sync::mpsc;

pub use app::{WrApp, WrCommand};
pub use types::{WrBuffer, WrEvent, WrEventCallback, WrEventType};
pub use webview::WrWebView;

use std::ptr;

// ============================================================================
// Lifecycle
// ============================================================================

#[no_mangle]
pub extern "C" fn wr_init() -> *mut WrApp {
    match WrApp::new() {
        Ok(app) => Box::into_raw(Box::new(app)),
        Err(e) => {
            eprintln!("[webrenderer] wr_init failed: {e}");
            ptr::null_mut()
        }
    }
}

/// Pump the event loop. Must be called from the main thread at ~60fps.
#[no_mangle]
pub unsafe extern "C" fn wr_pump(app: *mut WrApp) -> i32 {
    if app.is_null() {
        return -1;
    }
    (*app).pump()
}

#[no_mangle]
pub unsafe extern "C" fn wr_destroy(app: *mut WrApp) {
    if app.is_null() {
        return;
    }
    let app = Box::from_raw(app);
    app.destroy();
}

// ============================================================================
// WebView Management
// ============================================================================

#[no_mangle]
pub unsafe extern "C" fn wr_webview_create(
    app: *mut WrApp,
    url: *const c_char,
    width: i32,
    height: i32,
    callback: Option<WrEventCallback>,
    user_data: *mut std::ffi::c_void,
) -> u32 {
    if app.is_null() {
        return 0;
    }
    let url_str = if url.is_null() {
        None
    } else {
        Some(CStr::from_ptr(url).to_string_lossy().into_owned())
    };
    let id = (*app).alloc_id();
    if id == 0 {
        return 0;
    }
    let (result_tx, result_rx) = mpsc::sync_channel(1);
    let _ = (*app).send_command(WrCommand::CreateWebView {
        id,
        url: url_str,
        width,
        height,
        callback,
        user_data,
        result_tx,
    });
    // Pump the event loop to process the create command
    for _ in 0..50 {
        (*app).pump();
        if let Ok(result) = result_rx.try_recv() {
            return match result {
                Ok(webview_id) => webview_id,
                Err(_) => 0,
            };
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    0
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_navigate(app: *mut WrApp, id: u32, url: *const c_char) {
    if app.is_null() || url.is_null() || id == 0 {
        return;
    }
    let url = CStr::from_ptr(url).to_string_lossy().into_owned();
    let _ = (*app).send_command(WrCommand::Navigate { id, url });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_set_html(app: *mut WrApp, id: u32, html: *const c_char) {
    if app.is_null() || html.is_null() || id == 0 {
        return;
    }
    let html = CStr::from_ptr(html).to_string_lossy().into_owned();
    let _ = (*app).send_command(WrCommand::SetHtml { id, html });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_eval_js(app: *mut WrApp, id: u32, js: *const c_char) {
    if app.is_null() || js.is_null() || id == 0 {
        return;
    }
    let js = CStr::from_ptr(js).to_string_lossy().into_owned();
    let _ = (*app).send_command(WrCommand::EvalJs { id, js });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_resize(app: *mut WrApp, id: u32, width: i32, height: i32) {
    if app.is_null() || id == 0 {
        return;
    }
    let _ = (*app).send_command(WrCommand::Resize { id, width, height });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_destroy_by_id(app: *mut WrApp, id: u32) {
    if app.is_null() || id == 0 {
        return;
    }
    let _ = (*app).send_command(WrCommand::Navigate {
        id,
        url: "about:blank".into(),
    });
}

// ============================================================================
// Screenshot
// ============================================================================

#[no_mangle]
pub unsafe extern "C" fn wr_webview_screenshot(
    app: *mut WrApp,
    id: u32,
    format: u8,
    quality: u8,
) -> *mut WrBuffer {
    if app.is_null() || id == 0 {
        return ptr::null_mut();
    }
    let (result_tx, result_rx) = mpsc::sync_channel(1);
    let _ = (*app).send_command(WrCommand::Screenshot {
        id,
        format,
        quality,
        result_tx,
    });
    match result_rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(Some(buf)) => Box::into_raw(Box::new(buf)),
        _ => ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn wr_buffer_free(buf: *mut WrBuffer) {
    if buf.is_null() {
        return;
    }
    let buf = Box::from_raw(buf);
    buf.free();
}

// ============================================================================
// Input Injection
// ============================================================================

#[no_mangle]
pub unsafe extern "C" fn wr_webview_mouse_down(
    app: *mut WrApp,
    id: u32,
    x: i32,
    y: i32,
    button: u8,
) {
    if app.is_null() || id == 0 {
        return;
    }
    let _ = (*app).send_command(WrCommand::MouseDown { id, x, y, button });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_mouse_up(app: *mut WrApp, id: u32, x: i32, y: i32, button: u8) {
    if app.is_null() || id == 0 {
        return;
    }
    let _ = (*app).send_command(WrCommand::MouseUp { id, x, y, button });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_mouse_move(app: *mut WrApp, id: u32, x: i32, y: i32) {
    if app.is_null() || id == 0 {
        return;
    }
    let _ = (*app).send_command(WrCommand::MouseMove { id, x, y });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_mouse_wheel(
    app: *mut WrApp,
    id: u32,
    x: i32,
    y: i32,
    dx: f64,
    dy: f64,
) {
    if app.is_null() || id == 0 {
        return;
    }
    let _ = (*app).send_command(WrCommand::MouseWheel { id, x, y, dx, dy });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_key_down(
    app: *mut WrApp,
    id: u32,
    key: *const c_char,
    modifiers: u8,
) {
    if app.is_null() || id == 0 || key.is_null() {
        return;
    }
    let key = CStr::from_ptr(key).to_string_lossy().into_owned();
    let _ = (*app).send_command(WrCommand::KeyDown { id, key, modifiers });
}

#[no_mangle]
pub unsafe extern "C" fn wr_webview_insert_text(app: *mut WrApp, id: u32, text: *const c_char) {
    if app.is_null() || id == 0 || text.is_null() {
        return;
    }
    let text = CStr::from_ptr(text).to_string_lossy().into_owned();
    let _ = (*app).send_command(WrCommand::InsertText { id, text });
}

// ============================================================================
// Standalone Image Processing
// ============================================================================

#[no_mangle]
pub unsafe extern "C" fn wr_decode_png(
    input: *const u8,
    input_len: usize,
    out_w: *mut u32,
    out_h: *mut u32,
) -> *mut u8 {
    image_proc::decode_png(input, input_len, out_w, out_h)
}

#[no_mangle]
pub unsafe extern "C" fn wr_resize_rgba(
    pixels: *const u8,
    w: u32,
    h: u32,
    nw: u32,
    nh: u32,
    out_len: *mut usize,
) -> *mut u8 {
    image_proc::resize_rgba(pixels, w, h, nw, nh, out_len)
}

#[no_mangle]
pub unsafe extern "C" fn wr_free_buffer(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}
