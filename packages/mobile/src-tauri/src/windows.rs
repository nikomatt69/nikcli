use crate::constants::UPDATER_ENABLED;
use std::ops::Deref;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub struct MainWindow(WebviewWindow);

impl Deref for MainWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl MainWindow {
    pub const LABEL: &str = "main";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        if let Some(window) = app.get_webview_window(Self::LABEL) {
            return Ok(Self(window));
        }

        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, WebviewUrl::App("/".into())),
            app,
        );

        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        let window_builder = window_builder.title("Nikcli").visible(true);

        let window_builder = window_builder.initialization_script(format!(
            r#"
            window.__NIKCLI__ ??= {{}};
            window.__NIKCLI__.updaterEnabled = {UPDATER_ENABLED};
          "#
        ));

        let window = window_builder.build()?;
        Ok(Self(window))
    }
}

pub struct LoadingWindow(WebviewWindow);

impl Deref for LoadingWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl LoadingWindow {
    pub const LABEL: &str = "loading";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, tauri::WebviewUrl::App("/loading".into())),
            app,
        );

        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        let window_builder = window_builder.visible(true);

        Ok(Self(window_builder.build()?))
    }

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    pub fn close(self) -> Result<(), tauri::Error> {
        self.0.close()
    }

    #[cfg(any(target_os = "ios", target_os = "android"))]
    pub fn close(self) -> Result<(), tauri::Error> {
        drop(self);
        Ok(())
    }
}

fn base_window_config<'a, R: Runtime, M: Manager<R>>(
    window_builder: WebviewWindowBuilder<'a, R, M>,
    _app: &AppHandle,
) -> WebviewWindowBuilder<'a, R, M> {
    window_builder
}
