use std::ffi::c_void;

use http::Request;
use wry::{DragDropEvent, Rect, WebView, WebViewBuilder};

use crate::types::{
    WrBuffer, WrEvent, WrEventCallback, WrEventType, MOUSE_MIDDLE, MOUSE_RIGHT,
};

/// WebView wrapper holding the wry WebView and associated state.
pub struct WrWebView {
    pub id: u32,
    pub webview: WebView,
    #[allow(dead_code)]
    callback: Option<WrEventCallback>,
    #[allow(dead_code)]
    user_data: *mut c_void,
    width: i32,
    height: i32,
}

unsafe impl Send for WrWebView {}

impl WrWebView {
    pub fn new(
        id: u32,
        window: &tao::window::Window,
        url: Option<&str>,
        width: i32,
        height: i32,
        callback: Option<WrEventCallback>,
        user_data: *mut c_void,
    ) -> Result<Self, String> {
        let ipc_callback = callback;
        let ipc_user_data = user_data;
        let webview_id = id;

        let mut builder = WebViewBuilder::new()
            .with_bounds(Rect {
                position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
                size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
                    width as f64,
                    height as f64,
                )),
            })
            .with_transparent(false)
            .with_background_color((11, 18, 32, 255))
            .with_accept_first_mouse(true)
            .with_drag_drop_handler(|_event: DragDropEvent| false)
            .with_navigation_handler(|_url| true)
            .with_ipc_handler(move |req: Request<String>| {
                let body = req.body();

                // Forward IPC messages to the event callback
                if let Some(cb) = ipc_callback {
                    let ud = ipc_user_data;
                    let json = serde_json::to_vec(&serde_json::json!({
                        "type": "ipc",
                        "webview_id": webview_id,
                        "data": body
                    }))
                    .unwrap_or_default();
                    let event = WrEvent::new(WrEventType::IpcMessage, &json);
                    cb(&event, ud);
                    std::mem::forget(event);
                }
            });

        if let Some(url) = url {
            builder = builder.with_url(url);
        } else {
            builder = builder.with_url("about:blank");
        }

        // Minimal IPC bridge (no JS screenshot needed — we use native WKWebView.takeSnapshot)
        builder = builder.with_initialization_script(
            r#"
            if (!window.ipc) {
                window.ipc = {
                    postMessage: function(msg) {
                        if (typeof msg !== 'string') msg = JSON.stringify(msg);
                        window.ipc.postMessage(msg);
                    }
                };
            }
            "#,
        );

        let webview = builder
            .build_as_child(&window)
            .map_err(|e| format!("Failed to build webview: {e}"))?;

        Ok(WrWebView {
            id,
            webview,
            callback,
            user_data,
            width,
            height,
        })
    }

    pub fn navigate(&self, url: &str) {
        let _ = self.webview.load_url(url);
    }

    pub fn set_html(&self, html: &str) {
        let _ = self.webview.load_html(html);
    }

    pub fn eval_js(&self, js: &str) {
        let _ = self.webview.evaluate_script(js);
    }

    pub fn resize(&mut self, width: i32, height: i32) {
        self.width = width;
        self.height = height;
        let _ = self.webview.set_bounds(Rect {
            position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
            size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(width as f64, height as f64)),
        });
    }

    /// Capture a screenshot using native WKWebView.takeSnapshot on macOS.
    /// Bypasses all CORS/security restrictions — captures the actual rendered pixels.
    pub fn screenshot(&self, _format: u8, _quality: u8) -> Option<WrBuffer> {
        #[cfg(target_os = "macos")]
        {
            self.native_screenshot_macos()
        }
        #[cfg(not(target_os = "macos"))]
        {
            None
        }
    }

    #[cfg(target_os = "macos")]
    fn native_screenshot_macos(&self) -> Option<WrBuffer> {
        use block2::RcBlock;
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use std::ffi::c_void as FfiVoid;
        use std::sync::{Arc, Mutex};

        let result_cell: Arc<Mutex<Option<(Vec<u8>, u32, u32)>>> = Arc::new(Mutex::new(None));
        let done_flag: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));

        let result_clone = result_cell.clone();
        let done_clone = done_flag.clone();

        unsafe {
            // Get the underlying WKWebView (Retained<WryWebView> which deref to WKWebView)
            use wry::WebViewExtMacOS;
            let wk_retained = self.webview.webview();
            // Convert Retained<WryWebView> → raw *mut AnyObject for msg_send
            let wk_ptr: *const AnyObject = objc2::rc::Retained::as_ptr(&wk_retained).cast();

            // Build the completion handler block:
            //   ^(NSImage * _Nullable image, NSError * _Nullable error)
            let block = RcBlock::new(move |image: *mut FfiVoid, _error: *mut FfiVoid| {
                if image.is_null() {
                    *done_clone.lock().unwrap() = true;
                    return;
                }

                // NSImage → TIFFRepresentation → NSBitmapImageRep → raw RGBA pixels
                let ns_image = image as *mut AnyObject;

                let tiff_data: *mut AnyObject = msg_send![ns_image, TIFFRepresentation];
                if tiff_data.is_null() {
                    *done_clone.lock().unwrap() = true;
                    return;
                }

                let bitmap_class = objc2::runtime::AnyClass::get(c"NSBitmapImageRep").unwrap();
                let bitmap: *mut AnyObject =
                    msg_send![bitmap_class, imageRepWithData: tiff_data];
                if bitmap.is_null() {
                    *done_clone.lock().unwrap() = true;
                    return;
                }

                let bmp_w: isize = msg_send![bitmap, pixelsWide];
                let bmp_h: isize = msg_send![bitmap, pixelsHigh];
                let bmp_data: *const u8 = msg_send![bitmap, bitmapData];

                if bmp_data.is_null() || bmp_w <= 0 || bmp_h <= 0 {
                    *done_clone.lock().unwrap() = true;
                    return;
                }

                let samples: isize = msg_send![bitmap, samplesPerPixel];
                let stride: isize = msg_send![bitmap, bytesPerRow];
                let mut rgba = vec![0u8; (bmp_w * bmp_h) as usize * 4];

                for y in 0..bmp_h as usize {
                    for x in 0..bmp_w as usize {
                        let src = y * stride as usize + x * samples as usize;
                        let dst = (y * bmp_w as usize + x) * 4;
                        rgba[dst] = *bmp_data.add(src);
                        rgba[dst + 1] = *bmp_data.add(src + 1);
                        rgba[dst + 2] = *bmp_data.add(src + 2);
                        rgba[dst + 3] = if samples >= 4 {
                            *bmp_data.add(src + 3)
                        } else {
                            255
                        };
                    }
                }

                *result_clone.lock().unwrap() = Some((rgba, bmp_w as u32, bmp_h as u32));
                *done_clone.lock().unwrap() = true;
            });

            // [wkWebView takeSnapshotWithConfiguration:nil completionHandler:block]
            let _: () = msg_send![
                wk_ptr,
                takeSnapshotWithConfiguration: std::ptr::null::<AnyObject>(),
                completionHandler: &*block
            ];

            // Pump the run loop so the async callback can fire (we're on main thread)
            let rl_class = objc2::runtime::AnyClass::get(c"NSRunLoop").unwrap();
            let run_loop: *mut AnyObject = msg_send![rl_class, currentRunLoop];
            let date_class = objc2::runtime::AnyClass::get(c"NSDate").unwrap();

            for _ in 0..300 {
                if *done_flag.lock().unwrap() {
                    break;
                }
                let date: *mut AnyObject =
                    msg_send![date_class, dateWithTimeIntervalSinceNow: 0.01f64];
                let _: () = msg_send![run_loop, runUntilDate: date];
            }
        }

        let guard = result_cell.lock().unwrap();
        guard
            .as_ref()
            .map(|(pixels, w, h)| WrBuffer::new(pixels.clone(), *w, *h))
    }

    // ========================================================================
    // Input Injection
    // ========================================================================

    pub fn mouse_down(&self, x: i32, y: i32, button: u8) {
        let btn_val = match button {
            MOUSE_MIDDLE => 1,
            MOUSE_RIGHT => 2,
            _ => 0,
        };
        let js = format!(
            r#"
            (function() {{
                var el = document.elementFromPoint({x}, {y});
                if (el) {{
                    el.dispatchEvent(new MouseEvent('mousedown', {{
                        bubbles: true, cancelable: true, clientX: {x}, clientY: {y}, button: {btn_val}
                    }}));
                }}
            }})()
            "#
        );
        let _ = self.webview.evaluate_script(&js);
    }

    pub fn mouse_up(&self, x: i32, y: i32, button: u8) {
        let btn_val = match button {
            MOUSE_MIDDLE => 1,
            MOUSE_RIGHT => 2,
            _ => 0,
        };
        let js = format!(
            r#"
            (function() {{
                var el = document.elementFromPoint({x}, {y});
                if (el) {{
                    el.dispatchEvent(new MouseEvent('mouseup', {{
                        bubbles: true, cancelable: true, clientX: {x}, clientY: {y}, button: {btn_val}
                    }}));
                    el.dispatchEvent(new MouseEvent('click', {{
                        bubbles: true, cancelable: true, clientX: {x}, clientY: {y}
                    }}));
                }}
            }})()
            "#
        );
        let _ = self.webview.evaluate_script(&js);
    }

    pub fn mouse_move(&self, x: i32, y: i32) {
        let js = format!(
            r#"
            (function() {{
                var el = document.elementFromPoint({x}, {y});
                if (el) {{
                    el.dispatchEvent(new MouseEvent('mousemove', {{
                        bubbles: true, cancelable: true, clientX: {x}, clientY: {y}
                    }}));
                }}
            }})()
            "#
        );
        let _ = self.webview.evaluate_script(&js);
    }

    pub fn mouse_wheel(&self, x: i32, y: i32, dx: f64, dy: f64) {
        let js = format!(
            r#"
            (function() {{
                var el = document.elementFromPoint({x}, {y});
                if (el) {{
                    el.dispatchEvent(new WheelEvent('wheel', {{
                        bubbles: true, cancelable: true, deltaX: {dx}, deltaY: {dy}, deltaMode: 0
                    }}));
                }}
            }})()
            "#
        );
        let _ = self.webview.evaluate_script(&js);
    }

    pub fn key_down(&self, key: &str, modifiers: u8) {
        use crate::types::{MODIFIER_ALT, MODIFIER_CTRL, MODIFIER_META, MODIFIER_SHIFT};

        let shift = if modifiers & MODIFIER_SHIFT != 0 {
            "true"
        } else {
            "false"
        };
        let ctrl = if modifiers & MODIFIER_CTRL != 0 {
            "true"
        } else {
            "false"
        };
        let alt = if modifiers & MODIFIER_ALT != 0 {
            "true"
        } else {
            "false"
        };
        let meta = if modifiers & MODIFIER_META != 0 {
            "true"
        } else {
            "false"
        };

        let js = format!(
            r#"
            (function() {{
                var key = '{key}';
                var opts = {{
                    key: key, code: key, bubbles: true, cancelable: true,
                    shiftKey: {shift}, ctrlKey: {ctrl}, altKey: {alt}, metaKey: {meta}
                }};
                var target = document.activeElement || document.body;
                target.dispatchEvent(new KeyboardEvent('keydown', opts));
                target.dispatchEvent(new KeyboardEvent('keyup', opts));
            }})()
            "#
        );
        let _ = self.webview.evaluate_script(&js);
    }

    pub fn insert_text(&self, text: &str) {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('\'', "\\'")
            .replace('\n', "\\n")
            .replace('\r', "\\r");
        let js = format!(
            r#"
            (function() {{
                var target = document.activeElement || document.body;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {{
                    var start = target.selectionStart || 0;
                    var end = target.selectionEnd || 0;
                    var val = target.value || '';
                    target.value = val.slice(0, start) + '{escaped}' + val.slice(end);
                    target.selectionStart = target.selectionEnd = start + {len};
                    target.dispatchEvent(new Event('input', {{ bubbles: true }}));
                }} else if (target.isContentEditable) {{
                    document.execCommand('insertText', false, '{escaped}');
                }}
            }})()
            "#,
            len = text.len()
        );
        let _ = self.webview.evaluate_script(&js);
    }

    pub fn destroy(self) {}
}
