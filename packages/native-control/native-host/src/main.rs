use reqwest::blocking::Client;
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, env, thread, time::Duration};

#[derive(Clone, Debug, Deserialize)]
struct Surface {
    id: String,
    kind: String,
    title: String,
    body: Option<String>,
    #[serde(default)]
    controls: Vec<Control>,
}

#[derive(Clone, Debug, Deserialize)]
struct Control {
    #[serde(rename = "type")]
    kind: String,
    id: String,
    label: Option<String>,
    action: Option<String>,
    #[serde(default)]
    destructive: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum HostEvent {
    #[serde(rename = "control-activated")]
    ControlActivated {
        #[serde(rename = "surfaceId")]
        surface_id: String,
        #[serde(rename = "controlId")]
        control_id: String,
        action: Value,
    },
    #[serde(rename = "surface-closed")]
    SurfaceClosed {
        #[serde(rename = "surfaceId")]
        surface_id: String,
        reason: String,
    },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let base_url = argument("--url").unwrap_or_else(|| "http://127.0.0.1:4096".to_string());
    let interval = argument("--interval-ms")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(150);
    let client = Client::builder().timeout(Duration::from_secs(5)).build()?;
    let mut presented = HashSet::new();

    loop {
        match client
            .get(endpoint(&base_url, "/native-ui/surfaces"))
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.json::<Vec<Surface>>())
        {
            Ok(surfaces) => {
                let active = surfaces
                    .iter()
                    .map(|surface| surface.id.clone())
                    .collect::<HashSet<_>>();
                presented.retain(|id| active.contains(id));
                for surface in surfaces {
                    if !presented.insert(surface.id.clone()) {
                        continue;
                    }
                    present(client.clone(), base_url.clone(), surface);
                }
            }
            Err(error) => eprintln!("native host waiting for nikcli: {error}"),
        }
        thread::sleep(Duration::from_millis(interval));
    }
}

fn present(client: Client, base_url: String, surface: Surface) {
    thread::spawn(move || {
        match surface.kind.as_str() {
            "dialog" => present_dialog(&client, &base_url, &surface),
            "notification" => present_notification(&client, &base_url, &surface),
            // Popovers and menus remain registered and observable. Their native AppKit/GTK
            // renderer consumes the same protocol without changing the agent-facing API.
            "popover" | "menu" => {}
            _ => {}
        }
    });
}

fn present_dialog(client: &Client, base_url: &str, surface: &Surface) {
    let buttons = surface
        .controls
        .iter()
        .filter(|control| control.kind == "button")
        .take(3)
        .collect::<Vec<_>>();
    let labels = buttons
        .iter()
        .map(|control| control.label.clone().unwrap_or_else(|| control.id.clone()))
        .collect::<Vec<_>>();
    let message_buttons = match labels.as_slice() {
        [] => MessageButtons::Ok,
        [one] => MessageButtons::OkCustom(one.clone()),
        [one, two] => MessageButtons::OkCancelCustom(one.clone(), two.clone()),
        [one, two, three, ..] => {
            MessageButtons::YesNoCancelCustom(one.clone(), two.clone(), three.clone())
        }
    };
    let destructive = buttons.iter().any(|control| control.destructive);
    let result = MessageDialog::new()
        .set_title(&surface.title)
        .set_description(surface.body.as_deref().unwrap_or_default())
        .set_level(if destructive {
            MessageLevel::Warning
        } else {
            MessageLevel::Info
        })
        .set_buttons(message_buttons)
        .show();

    if let Some(control) = selected_control(&buttons, &result) {
        let action_name = control.action.as_deref().unwrap_or(&control.id);
        post_event(
            client,
            base_url,
            &HostEvent::ControlActivated {
                surface_id: surface.id.clone(),
                control_id: control.id.clone(),
                action: json!({ "type": "invoke", "action": action_name }),
            },
        );
    } else {
        post_event(
            client,
            base_url,
            &HostEvent::SurfaceClosed {
                surface_id: surface.id.clone(),
                reason: "dismissed".to_string(),
            },
        );
    }
}

fn present_notification(client: &Client, base_url: &str, surface: &Surface) {
    MessageDialog::new()
        .set_title(&surface.title)
        .set_description(surface.body.as_deref().unwrap_or_default())
        .set_level(MessageLevel::Info)
        .set_buttons(MessageButtons::Ok)
        .show();
    post_event(
        client,
        base_url,
        &HostEvent::SurfaceClosed {
            surface_id: surface.id.clone(),
            reason: "system".to_string(),
        },
    );
}

fn selected_control<'a>(
    buttons: &[&'a Control],
    result: &MessageDialogResult,
) -> Option<&'a Control> {
    match result {
        MessageDialogResult::Custom(label) => buttons
            .iter()
            .copied()
            .find(|control| control.label.as_deref() == Some(label)),
        MessageDialogResult::Ok | MessageDialogResult::Yes => buttons.first().copied(),
        MessageDialogResult::No => buttons.get(1).copied(),
        MessageDialogResult::Cancel => buttons.get(2).copied().or_else(|| buttons.get(1).copied()),
    }
}

fn post_event(client: &Client, base_url: &str, event: &HostEvent) {
    if let Err(error) = client
        .post(endpoint(base_url, "/native-ui/events"))
        .json(event)
        .send()
        .and_then(|response| response.error_for_status())
    {
        eprintln!("failed to return native interaction: {error}");
    }
}

fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

fn argument(name: &str) -> Option<String> {
    let mut args = env::args();
    while let Some(value) = args.next() {
        if value == name {
            return args.next();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_custom_button_to_control() {
        let control = Control {
            kind: "button".into(),
            id: "deploy".into(),
            label: Some("Deploy".into()),
            action: None,
            destructive: false,
        };
        assert_eq!(
            selected_control(&[&control], &MessageDialogResult::Custom("Deploy".into()))
                .map(|item| item.id.as_str()),
            Some("deploy")
        );
    }
}
