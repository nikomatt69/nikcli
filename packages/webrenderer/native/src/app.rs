use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder};
use tao::platform::run_return::EventLoopExtRunReturn;
use tao::window::WindowBuilder;

use crate::types::{WrBuffer, WrEvent, WrEventCallback, WrEventType};
use crate::webview::WrWebView;

pub enum WrCommand {
    CreateWebView {
        id: u32,
        url: Option<String>,
        width: i32,
        height: i32,
        callback: Option<WrEventCallback>,
        user_data: *mut std::ffi::c_void,
        result_tx: mpsc::SyncSender<Result<u32, String>>,
    },
    Navigate {
        id: u32,
        url: String,
    },
    SetHtml {
        id: u32,
        html: String,
    },
    EvalJs {
        id: u32,
        js: String,
    },
    Resize {
        id: u32,
        width: i32,
        height: i32,
    },
    MouseDown {
        id: u32,
        x: i32,
        y: i32,
        button: u8,
    },
    MouseUp {
        id: u32,
        x: i32,
        y: i32,
        button: u8,
    },
    MouseMove {
        id: u32,
        x: i32,
        y: i32,
    },
    MouseWheel {
        id: u32,
        x: i32,
        y: i32,
        dx: f64,
        dy: f64,
    },
    KeyDown {
        id: u32,
        key: String,
        modifiers: u8,
    },
    InsertText {
        id: u32,
        text: String,
    },
    Screenshot {
        id: u32,
        format: u8,
        quality: u8,
        result_tx: mpsc::SyncSender<Option<WrBuffer>>,
    },
    Shutdown,
}

unsafe impl Send for WrCommand {}

struct AppState {
    window: tao::window::Window,
    webviews: HashMap<u32, WrWebView>,
    next_id: u32,
}

// Event loop on main thread only (thread-local)
thread_local! {
    static TL_EVENT_LOOP: RefCell<Option<EventLoop<WrCommand>>> = RefCell::new(None);
    static TL_APP_STATE: RefCell<Option<AppState>> = RefCell::new(None);
}

// Command channel accessible from any thread
static COMMAND_TX: Lazy<Mutex<Option<mpsc::Sender<WrCommand>>>> = Lazy::new(|| Mutex::new(None));
static COMMAND_RX: Lazy<Mutex<Option<mpsc::Receiver<WrCommand>>>> = Lazy::new(|| Mutex::new(None));

pub struct WrApp;

impl WrApp {
    pub fn new() -> Result<Self, String> {
        if COMMAND_TX.lock().unwrap().is_some() {
            return Err("webrenderer already initialized".into());
        }

        let event_loop = EventLoopBuilder::with_user_event().build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .with_inner_size(LogicalSize::new(800.0, 600.0))
            .with_title("webrenderer")
            .build(&event_loop)
            .map_err(|e| format!("Failed to create window: {e}"))?;

        let (command_tx, command_rx) = mpsc::channel::<WrCommand>();

        TL_EVENT_LOOP.with(|el| *el.borrow_mut() = Some(event_loop));
        TL_APP_STATE.with(|st| {
            *st.borrow_mut() = Some(AppState {
                window,
                webviews: HashMap::new(),
                next_id: 1,
            })
        });
        *COMMAND_TX.lock().unwrap() = Some(command_tx);
        *COMMAND_RX.lock().unwrap() = Some(command_rx);

        Ok(WrApp)
    }

    pub fn alloc_id(&self) -> u32 {
        TL_APP_STATE.with(|st| {
            if let Some(ref mut s) = *st.borrow_mut() {
                let id = s.next_id;
                s.next_id += 1;
                id
            } else {
                0
            }
        })
    }

    pub fn send_command(&self, cmd: WrCommand) -> Result<(), String> {
        let tx = COMMAND_TX.lock().unwrap();
        if let Some(ref sender) = *tx {
            sender.send(cmd).map_err(|e| format!("send_command: {e}"))
        } else {
            Err("not initialized".into())
        }
    }

    /// Pump event loop + process commands. Must be called from main thread.
    pub fn pump(&self) -> i32 {
        let mut count = 0;

        // Process pending commands
        {
            let rx_guard = COMMAND_RX.lock().unwrap();
            if let Some(ref rx) = *rx_guard {
                while let Ok(cmd) = rx.try_recv() {
                    TL_APP_STATE.with(|st| {
                        if let Some(ref mut state) = *st.borrow_mut() {
                            handle_command(state, cmd);
                            count += 1;
                        }
                    });
                }
            }
        }

        // Drive tao event loop briefly
        TL_EVENT_LOOP.with(|el_cell| {
            if let Some(ref mut el) = *el_cell.borrow_mut() {
                el.run_return(|event, _, control_flow| {
                    *control_flow = ControlFlow::WaitUntil(
                        std::time::Instant::now() + std::time::Duration::from_millis(50),
                    );
                    match event {
                        Event::WindowEvent {
                            event: WindowEvent::CloseRequested,
                            ..
                        } => *control_flow = ControlFlow::Exit,
                        Event::UserEvent(cmd) => {
                            TL_APP_STATE.with(|st| {
                                if let Some(ref mut state) = *st.borrow_mut() {
                                    handle_command(state, cmd);
                                    count += 1;
                                }
                            });
                        }
                        Event::MainEventsCleared => *control_flow = ControlFlow::Exit,
                        _ => {}
                    }
                });
            }
        });

        count
    }

    pub fn destroy(self) {
        TL_APP_STATE.with(|st| {
            if let Some(state) = st.borrow_mut().take() {
                for (_, wv) in state.webviews.into_iter() {
                    wv.destroy();
                }
            }
        });
        TL_EVENT_LOOP.with(|el| *el.borrow_mut() = None);
        *COMMAND_TX.lock().unwrap() = None;
        *COMMAND_RX.lock().unwrap() = None;
    }
}

fn handle_command(state: &mut AppState, cmd: WrCommand) {
    match cmd {
        WrCommand::CreateWebView {
            id,
            url,
            width,
            height,
            callback,
            user_data,
            result_tx,
        } => {
            let result = WrWebView::new(
                id,
                &state.window,
                url.as_deref(),
                width,
                height,
                callback,
                user_data,
            )
            .map(|wv| {
                state.webviews.insert(id, wv);
                id
            });
            let _ = result_tx.send(result);
        }
        WrCommand::Navigate { id, url } => {
            if id > 0 {
                if let Some(wv) = state.webviews.get(&id) {
                    wv.navigate(&url);
                }
            }
        }
        WrCommand::SetHtml { id, html } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.set_html(&html);
            }
        }
        WrCommand::EvalJs { id, js } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.eval_js(&js);
            }
        }
        WrCommand::Resize { id, width, height } => {
            if let Some(wv) = state.webviews.get_mut(&id) {
                wv.resize(width, height);
            }
        }
        WrCommand::MouseDown { id, x, y, button } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.mouse_down(x, y, button);
            }
        }
        WrCommand::MouseUp { id, x, y, button } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.mouse_up(x, y, button);
            }
        }
        WrCommand::MouseMove { id, x, y } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.mouse_move(x, y);
            }
        }
        WrCommand::MouseWheel { id, x, y, dx, dy } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.mouse_wheel(x, y, dx, dy);
            }
        }
        WrCommand::KeyDown { id, key, modifiers } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.key_down(&key, modifiers);
            }
        }
        WrCommand::InsertText { id, text } => {
            if let Some(wv) = state.webviews.get(&id) {
                wv.insert_text(&text);
            }
        }
        WrCommand::Screenshot {
            id,
            format,
            quality,
            result_tx,
        } => {
            let result = state
                .webviews
                .get(&id)
                .and_then(|wv| wv.screenshot(format, quality));
            let _ = result_tx.send(result);
        }
        WrCommand::Shutdown => {}
    }
}
