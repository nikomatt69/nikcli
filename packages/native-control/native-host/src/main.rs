use reqwest::blocking::Client;
use rfd::{AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    env,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

type Generations = Arc<Mutex<HashMap<String, String>>>;
type Processes = Arc<Mutex<HashMap<String, u32>>>;

#[cfg(target_os = "macos")]
const MACOS_DIALOG_SCRIPT: &str = r#"
ObjC.import("AppKit");

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function label(value, frame) {
  const view = $.NSTextField.alloc.initWithFrame(frame);
  view.stringValue = text(value);
  view.editable = false;
  view.selectable = false;
  view.bordered = false;
  view.drawsBackground = false;
  return view;
}

ObjC.registerSubclass({
  name: "NikcliLiquidGlassDelegate",
  methods: {
    "performAction:": {
      types: ["void", ["id"]],
      implementation: function(sender) {
        $.NSApplication.sharedApplication.stopModalWithCode(Number(sender.tag));
      }
    }
  }
});

function run(argv) {
  const surface = JSON.parse(argv[0]);
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1);
  app.activateIgnoringOtherApps(true);

  const controls = (surface.controls || []).filter((control) =>
    ["text-input", "select", "checkbox", "progress", "metric", "section", "separator"].includes(control.type)
  );
  const metrics = controls.filter((control) => control.type === "metric");
  const flowControls = controls.filter((control) => control.type !== "metric");
  const actions = surface.kind === "menu"
    ? (surface.items || []).filter((item) => !item.disabled)
    : (surface.controls || []).filter((control) =>
        (control.type === "button" || control.type === "link") && !control.disabled
      );
  const controlsHeight = flowControls.reduce((total, control) =>
    total + (control.type === "separator" ? 16 : control.type === "section" ? 46 : control.type === "progress" ? 48 : control.type === "text-input" && control.multiline ? 86 : 34), 0
  );
  const actionsHeight = surface.kind === "menu" ? Math.max(58, actions.length * 42 + 16) : 66;
  const bodyHeight = surface.body
    ? Math.min(180, Math.max(30, text(surface.body).split("\n").length * 18))
    : 0;
  const dashboard = surface.layout === "dashboard";
  const width = surface.width === "large" || dashboard ? 780 : surface.width === "small" ? 420 : 520;
  const metricColumns = width >= 700 ? 3 : 2;
  const metricRows = Math.ceil(metrics.length / metricColumns);
  const metricsHeight = metricRows > 0 ? metricRows * 100 + 8 : 0;
  const height = Math.max(250, Math.min(840, 88 + bodyHeight + metricsHeight + controlsHeight + actionsHeight));
  const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(0, 0, width, height), 32769, 2, false
  );
  panel.title = text(surface.title);
  panel.titleVisibility = 1;
  panel.titlebarAppearsTransparent = true;
  panel.backgroundColor = $.NSColor.clearColor;
  panel.opaque = false;
  panel.hasShadow = true;
  panel.movableByWindowBackground = true;

  const frame = $.NSMakeRect(0, 0, width, height);
  const glassClass = $.NSClassFromString("NSGlassEffectView");
  let glass;
  if (glassClass) {
    glass = glassClass.alloc.initWithFrame(frame);
    glass.cornerRadius = 30;
    glass.style = 0;
    const tint = surface.severity === "success"
      ? $.NSColor.systemGreenColor
      : surface.severity === "warning"
        ? $.NSColor.systemOrangeColor
        : surface.severity === "error"
          ? $.NSColor.systemRedColor
          : $.NSColor.controlAccentColor;
    glass.tintColor = tint.colorWithAlphaComponent(0.08);
    if (glass.respondsToSelector("setEffectIsInteractive:")) glass.effectIsInteractive = true;
  } else {
    glass = $.NSVisualEffectView.alloc.initWithFrame(frame);
    glass.material = 15;
    glass.blendingMode = 0;
    glass.state = 1;
    glass.wantsLayer = true;
    glass.layer.cornerRadius = 30;
    glass.layer.masksToBounds = true;
  }

  const content = $.NSView.alloc.initWithFrame(frame);
  const title = label(surface.title, $.NSMakeRect(28, height - 66, width - 56, 34));
  title.font = $.NSFont.systemFontOfSizeWeight(24, 0.6);
  content.addSubview(title);
  if (surface.body) {
    const body = label(surface.body, $.NSMakeRect(28, height - 82 - bodyHeight, width - 56, bodyHeight));
    body.textColor = $.NSColor.secondaryLabelColor;
    body.cell.wraps = true;
    body.cell.usesSingleLineMode = false;
    content.addSubview(body);
  }

  const widgets = {};
  let y = height - 94 - bodyHeight;
  if (metrics.length > 0) {
    const cardGap = 12;
    const cardHeight = 88;
    const cardWidth = (width - 56 - cardGap * (metricColumns - 1)) / metricColumns;
    metrics.forEach((metric, index) => {
      const column = index % metricColumns;
      const row = Math.floor(index / metricColumns);
      const cardX = 28 + column * (cardWidth + cardGap);
      const cardY = y - cardHeight - row * (cardHeight + cardGap);
      const card = $.NSBox.alloc.initWithFrame($.NSMakeRect(cardX, cardY, cardWidth, cardHeight));
      const tone = metric.tone === "success"
        ? $.NSColor.systemGreenColor
        : metric.tone === "warning"
          ? $.NSColor.systemOrangeColor
          : metric.tone === "error"
            ? $.NSColor.systemRedColor
            : metric.tone === "info"
              ? $.NSColor.systemBlueColor
              : $.NSColor.secondaryLabelColor;
      card.boxType = 4;
      card.fillColor = tone.colorWithAlphaComponent(0.09);
      card.borderColor = tone.colorWithAlphaComponent(0.2);
      card.borderWidth = 1;
      card.cornerRadius = 16;

      const metricLabel = label(metric.label, $.NSMakeRect(16, 58, cardWidth - 32, 18));
      metricLabel.textColor = $.NSColor.secondaryLabelColor;
      metricLabel.font = $.NSFont.systemFontOfSizeWeight(12, 0.5);
      card.addSubview(metricLabel);
      const metricValue = label(metric.value, $.NSMakeRect(16, 26, cardWidth - 32, 30));
      metricValue.font = $.NSFont.systemFontOfSizeWeight(24, 0.65);
      card.addSubview(metricValue);
      const supporting = [metric.detail, metric.trend].filter(Boolean).join(" | ");
      if (supporting) {
        const metricDetail = label(supporting, $.NSMakeRect(16, 8, cardWidth - 32, 16));
        metricDetail.textColor = $.NSColor.secondaryLabelColor;
        metricDetail.font = $.NSFont.systemFontOfSize(11);
        card.addSubview(metricDetail);
      }
      content.addSubview(card);
    });
    y -= metricsHeight;
  }
  for (const control of flowControls) {
    if (control.type === "separator") {
      y -= 12;
      const separator = $.NSBox.alloc.initWithFrame($.NSMakeRect(28, y, width - 56, 1));
      separator.boxType = 2;
      content.addSubview(separator);
      y -= 4;
      continue;
    }
    if (control.type === "section") {
      y -= 40;
      const sectionTitle = label(control.label, $.NSMakeRect(28, y + 16, width - 56, 22));
      sectionTitle.font = $.NSFont.systemFontOfSizeWeight(15, 0.6);
      content.addSubview(sectionTitle);
      if (control.detail) {
        const sectionDetail = label(control.detail, $.NSMakeRect(28, y, width - 56, 18));
        sectionDetail.textColor = $.NSColor.secondaryLabelColor;
        sectionDetail.font = $.NSFont.systemFontOfSize(12);
        content.addSubview(sectionDetail);
      }
      y -= 6;
      continue;
    }
    if (control.type === "progress") {
      y -= 20;
      const progressText = [control.label || "Progress", control.detail].filter(Boolean).join(" | ");
      const progressLabel = label(progressText, $.NSMakeRect(28, y, width - 56, 18));
      progressLabel.textColor = $.NSColor.secondaryLabelColor;
      content.addSubview(progressLabel);
      y -= 24;
      const progress = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(28, y, width - 56, 14));
      progress.indeterminate = Boolean(control.indeterminate);
      progress.minValue = 0;
      progress.maxValue = 1;
      progress.doubleValue = Number(control.value || 0);
      if (control.indeterminate) progress.startAnimation(null);
      content.addSubview(progress);
      continue;
    }

    const rowHeight = control.type === "text-input" && control.multiline ? 82 : 30;
    y -= rowHeight;
    if (control.type === "checkbox") {
      const checkbox = $.NSButton.alloc.initWithFrame($.NSMakeRect(28, y, width - 56, 24));
      checkbox.buttonType = 3;
      checkbox.title = text(control.label);
      checkbox.state = control.checked ? 1 : 0;
      checkbox.enabled = !control.disabled;
      content.addSubview(checkbox);
      widgets[control.id] = { type: control.type, view: checkbox };
      continue;
    }

    const labelWidth = width >= 700 ? 180 : 150;
    const fieldX = 28 + labelWidth + 6;
    const fieldWidth = width - fieldX - 28;
    const controlLabel = label(control.label || control.id, $.NSMakeRect(28, y + rowHeight - 27, labelWidth, 20));
    controlLabel.textColor = $.NSColor.secondaryLabelColor;
    content.addSubview(controlLabel);
    if (control.type === "text-input") {
      if (control.multiline) {
        const scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(fieldX, y, fieldWidth, 76));
        scroll.hasVerticalScroller = true;
        scroll.borderType = 2;
        const editor = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, fieldWidth - 8, 76));
        editor.string = text(control.value);
        editor.editable = !control.disabled;
        scroll.documentView = editor;
        content.addSubview(scroll);
        widgets[control.id] = { type: control.type, view: editor, multiline: true };
      } else {
        const field = (control.secure ? $.NSSecureTextField : $.NSTextField).alloc.initWithFrame($.NSMakeRect(fieldX, y, fieldWidth, 26));
        field.stringValue = text(control.value);
        field.placeholderString = text(control.placeholder);
        field.enabled = !control.disabled;
        content.addSubview(field);
        widgets[control.id] = { type: control.type, view: field, multiline: false };
      }
    } else if (control.type === "select") {
      const popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(fieldX, y, fieldWidth, 26), false);
      for (const option of control.options || []) popup.addItemWithTitle(text(option.label));
      const selected = (control.options || []).findIndex((option) => option.id === control.value);
      if (selected >= 0) popup.selectItemAtIndex(selected);
      popup.enabled = !control.disabled;
      content.addSubview(popup);
      widgets[control.id] = { type: control.type, view: popup, options: control.options || [] };
    }
  }

  const delegate = $.NikcliLiquidGlassDelegate.alloc.init;
  if (surface.kind === "menu") {
    actions.forEach((action, index) => {
      const buttonY = 24 + (actions.length - index - 1) * 42;
      const button = $.NSButton.alloc.initWithFrame($.NSMakeRect(28, buttonY, width - 56, 34));
      button.title = (action.checked ? "[x] " : "") + text(action.label || action.id);
      button.bezelStyle = 15;
      button.tag = 1000 + index;
      button.target = delegate;
      button.action = "performAction:";
      content.addSubview(button);
    });
  } else if (actions.length > 0) {
    let buttonX = width - 28;
    actions.slice().reverse().forEach((action, reverseIndex) => {
      const index = actions.length - reverseIndex - 1;
      const buttonWidth = Math.max(104, Math.min(170, text(action.label).length * 8 + 32));
      buttonX -= buttonWidth;
      const button = $.NSButton.alloc.initWithFrame($.NSMakeRect(buttonX, 24, buttonWidth, 34));
      button.title = text(action.label || action.id);
      button.bezelStyle = 15;
      button.tag = 1000 + index;
      button.target = delegate;
      button.action = "performAction:";
      if (index === 0) button.keyEquivalent = "\r";
      content.addSubview(button);
      buttonX -= 10;
    });
  } else {
    const close = $.NSButton.alloc.initWithFrame($.NSMakeRect(width - 132, 24, 104, 34));
    close.title = "Close";
    close.bezelStyle = 15;
    close.tag = 0;
    close.target = delegate;
    close.action = "performAction:";
    content.addSubview(close);
  }

  if (glassClass) glass.contentView = content;
  else glass.addSubview(content);
  panel.contentView = glass;
  if (surface.kind === "popover" && surface.anchor && (surface.anchor.x > 0 || surface.anchor.y > 0)) {
    panel.setFrameOrigin($.NSMakePoint(surface.anchor.x, Math.max(24, surface.anchor.y - height)));
  } else {
    panel.center;
  }
  panel.alphaValue = 0;
  panel.makeKeyAndOrderFront(null);
  panel.animator.alphaValue = 1;
  const response = Number(app.runModalForWindow(panel));

  const values = {};
  for (const id of Object.keys(widgets)) {
    const widget = widgets[id];
    if (widget.type === "text-input") values[id] = ObjC.unwrap(widget.multiline ? widget.view.string : widget.view.stringValue);
    if (widget.type === "checkbox") values[id] = Number(widget.view.state) === 1;
    if (widget.type === "select") {
      const index = Number(widget.view.indexOfSelectedItem);
      values[id] = widget.options[index] ? widget.options[index].id : "";
    }
  }
  panel.orderOut(null);
  const buttonIndex = actions.length > 0 && response >= 1000 ? response - 1000 : null;
  return JSON.stringify({ buttonIndex, values });
}
"#;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Surface {
    id: String,
    kind: String,
    title: String,
    body: Option<String>,
    #[serde(default)]
    controls: Vec<Control>,
    #[serde(default)]
    items: Vec<MenuItem>,
    #[serde(rename = "durationMs")]
    duration_ms: Option<u64>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Control {
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
    label: Option<String>,
    action: Option<String>,
    url: Option<String>,
    value: Option<Value>,
    placeholder: Option<String>,
    checked: Option<bool>,
    detail: Option<String>,
    #[serde(default)]
    options: Vec<SelectOption>,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    destructive: bool,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SelectOption {
    id: String,
    label: String,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MenuItem {
    id: String,
    label: String,
    action: Option<String>,
    #[serde(default)]
    disabled: bool,
    checked: Option<bool>,
    #[serde(flatten)]
    extra: Map<String, Value>,
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
    #[serde(rename = "control-changed")]
    ControlChanged {
        #[serde(rename = "surfaceId")]
        surface_id: String,
        #[serde(rename = "controlId")]
        control_id: String,
        value: Value,
    },
    #[serde(rename = "surface-closed")]
    SurfaceClosed {
        #[serde(rename = "surfaceId")]
        surface_id: String,
        reason: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeResult {
    button_index: Option<usize>,
    #[serde(default)]
    values: Map<String, Value>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let base_url = argument("--url").unwrap_or_else(|| "http://127.0.0.1:4096".to_string());
    let interval = argument("--interval-ms")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(150);
    let client = Client::builder().timeout(Duration::from_secs(5)).build()?;
    let mut presented = HashMap::<String, String>::new();
    let generations = Arc::new(Mutex::new(HashMap::<String, String>::new()));
    let processes = Arc::new(Mutex::new(HashMap::<String, u32>::new()));
    let mut last_error_log = Instant::now() - Duration::from_secs(5);

    loop {
        let connected = match client
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
                for id in presented
                    .keys()
                    .filter(|id| !active.contains(*id))
                    .cloned()
                    .collect::<Vec<_>>()
                {
                    cancel_presentation(&id, &generations, &processes);
                    presented.remove(&id);
                }
                for surface in surfaces {
                    let fingerprint = serde_json::to_string(&surface)?;
                    if presented.get(&surface.id) == Some(&fingerprint) {
                        continue;
                    }
                    cancel_presentation(&surface.id, &generations, &processes);
                    presented.insert(surface.id.clone(), fingerprint.clone());
                    generations
                        .lock()
                        .expect("native generations lock poisoned")
                        .insert(surface.id.clone(), fingerprint.clone());
                    present(
                        client.clone(),
                        base_url.clone(),
                        surface,
                        fingerprint,
                        Arc::clone(&generations),
                        Arc::clone(&processes),
                    );
                }
                true
            }
            Err(error) => {
                if last_error_log.elapsed() >= Duration::from_secs(5) {
                    eprintln!("native host waiting for nikcli: {error}");
                    last_error_log = Instant::now();
                }
                false
            }
        };
        thread::sleep(if connected {
            Duration::from_millis(interval)
        } else {
            Duration::from_millis(interval.max(500))
        });
    }
}

fn present(
    client: Client,
    base_url: String,
    surface: Surface,
    generation: String,
    generations: Generations,
    processes: Processes,
) {
    thread::spawn(move || match surface.kind.as_str() {
        "dialog" => present_dialog(
            &client,
            &base_url,
            &surface,
            &generation,
            &generations,
            &processes,
        ),
        "notification" if surface.controls.is_empty() => {
            present_notification(&client, &base_url, &surface, &generation, &generations)
        }
        "notification" => present_dialog(
            &client,
            &base_url,
            &surface,
            &generation,
            &generations,
            &processes,
        ),
        "popover" => present_dialog(
            &client,
            &base_url,
            &surface,
            &generation,
            &generations,
            &processes,
        ),
        "menu" => present_menu(
            &client,
            &base_url,
            &surface,
            &generation,
            &generations,
            &processes,
        ),
        _ => post_event(
            &client,
            &base_url,
            &HostEvent::SurfaceClosed {
                surface_id: surface.id,
                reason: "system".to_string(),
            },
        ),
    });
}

fn cancel_presentation(id: &str, generations: &Generations, processes: &Processes) {
    generations
        .lock()
        .expect("native generations lock poisoned")
        .remove(id);
    if let Some(pid) = processes
        .lock()
        .expect("native processes lock poisoned")
        .remove(id)
    {
        #[cfg(target_os = "macos")]
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

fn is_current(id: &str, generation: &str, generations: &Generations) -> bool {
    generations
        .lock()
        .expect("native generations lock poisoned")
        .get(id)
        .is_some_and(|current| current == generation)
}

fn present_dialog(
    client: &Client,
    base_url: &str,
    surface: &Surface,
    generation: &str,
    generations: &Generations,
    processes: &Processes,
) {
    let buttons = surface
        .controls
        .iter()
        .filter(|control| (control.kind == "button" || control.kind == "link") && !control.disabled)
        .collect::<Vec<_>>();
    let labels = buttons
        .iter()
        .take(3)
        .map(|control| {
            control
                .label
                .clone()
                .or_else(|| control.id.clone())
                .unwrap_or_else(|| control.kind.clone())
        })
        .collect::<Vec<_>>();

    #[cfg(target_os = "macos")]
    if let Some(result) = present_macos(surface, generation, generations, processes) {
        if !is_current(&surface.id, generation, generations) {
            return;
        }
        post_changes(client, base_url, surface, &result.values);
        if let Some(control) = result.button_index.and_then(|index| buttons.get(index)) {
            post_control(client, base_url, surface, control, result.values);
        } else {
            post_closed(client, base_url, surface, "dismissed");
        }
        return;
    }
    if !is_current(&surface.id, generation, generations) {
        return;
    }

    let message_buttons = match labels.as_slice() {
        [] => MessageButtons::Ok,
        [one] => MessageButtons::OkCustom(one.clone()),
        [one, two] => MessageButtons::OkCancelCustom(one.clone(), two.clone()),
        [one, two, three, ..] => {
            MessageButtons::YesNoCancelCustom(one.clone(), two.clone(), three.clone())
        }
    };
    let destructive = buttons.iter().any(|control| control.destructive);
    let result = pollster::block_on(
        AsyncMessageDialog::new()
            .set_title(&surface.title)
            .set_description(surface_description(surface))
            .set_level(if destructive {
                MessageLevel::Warning
            } else {
                MessageLevel::Info
            })
            .set_buttons(message_buttons)
            .show(),
    );

    if !is_current(&surface.id, generation, generations) {
        return;
    }

    if let Some(control) = selected_control(&buttons, &result) {
        post_control(client, base_url, surface, control, control_values(surface));
    } else {
        post_closed(client, base_url, surface, "dismissed");
    }
}

fn present_notification(
    client: &Client,
    base_url: &str,
    surface: &Surface,
    generation: &str,
    generations: &Generations,
) {
    #[cfg(target_os = "macos")]
    let shown = Command::new("osascript")
        .args([
            "-e",
            &format!(
                "display notification {} with title {}",
                apple_script_string(surface.body.as_deref().unwrap_or_default()),
                apple_script_string(&surface.title),
            ),
        ])
        .status()
        .is_ok_and(|status| status.success());

    #[cfg(not(target_os = "macos"))]
    let shown = false;

    if !shown {
        pollster::block_on(
            AsyncMessageDialog::new()
                .set_title(&surface.title)
                .set_description(surface.body.as_deref().unwrap_or_default())
                .set_level(MessageLevel::Info)
                .set_buttons(MessageButtons::Ok)
                .show(),
        );
    } else if let Some(duration_ms) = surface.duration_ms {
        thread::sleep(Duration::from_millis(duration_ms));
    }
    if !is_current(&surface.id, generation, generations) {
        return;
    }
    post_event(
        client,
        base_url,
        &HostEvent::SurfaceClosed {
            surface_id: surface.id.clone(),
            reason: "system".to_string(),
        },
    );
}

fn present_menu(
    client: &Client,
    base_url: &str,
    surface: &Surface,
    generation: &str,
    generations: &Generations,
    processes: &Processes,
) {
    let items = surface
        .items
        .iter()
        .filter(|item| !item.disabled)
        .collect::<Vec<_>>();
    let labels = items
        .iter()
        .take(3)
        .map(|item| {
            if item.checked == Some(true) {
                format!("[x] {}", item.label)
            } else {
                item.label.clone()
            }
        })
        .collect::<Vec<_>>();

    #[cfg(target_os = "macos")]
    if let Some(result) = present_macos(surface, generation, generations, processes) {
        if !is_current(&surface.id, generation, generations) {
            return;
        }
        if let Some(item) = result.button_index.and_then(|index| items.get(index)) {
            post_event(
                client,
                base_url,
                &HostEvent::ControlActivated {
                    surface_id: surface.id.clone(),
                    control_id: item.id.clone(),
                    action: json!({
                        "type": "invoke",
                        "action": item.action.as_deref().unwrap_or(&item.id),
                    }),
                },
            );
            post_closed(client, base_url, surface, "action");
        } else {
            post_closed(client, base_url, surface, "dismissed");
        }
        return;
    }
    if !is_current(&surface.id, generation, generations) {
        return;
    }

    let buttons = message_buttons(&labels);
    let result = pollster::block_on(
        AsyncMessageDialog::new()
            .set_title(&surface.title)
            .set_description(surface.body.as_deref().unwrap_or("Choose an action"))
            .set_buttons(buttons)
            .show(),
    );
    if !is_current(&surface.id, generation, generations) {
        return;
    }
    if let Some(index) = selected_index(&result, &labels) {
        if let Some(item) = items.get(index) {
            post_event(
                client,
                base_url,
                &HostEvent::ControlActivated {
                    surface_id: surface.id.clone(),
                    control_id: item.id.clone(),
                    action: json!({
                        "type": "invoke",
                        "action": item.action.as_deref().unwrap_or(&item.id),
                    }),
                },
            );
            post_closed(client, base_url, surface, "action");
            return;
        }
    }
    post_closed(client, base_url, surface, "dismissed");
}

#[cfg(target_os = "macos")]
fn present_macos(
    surface: &Surface,
    generation: &str,
    generations: &Generations,
    processes: &Processes,
) -> Option<NativeResult> {
    let input = serde_json::to_string(surface).ok()?;
    let mut child = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", MACOS_DIALOG_SCRIPT, "--", &input])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let pid = child.id();
    let current = generations
        .lock()
        .expect("native generations lock poisoned");
    if current
        .get(&surface.id)
        .is_none_or(|value| value != generation)
    {
        drop(current);
        let _ = child.kill();
        let _ = child.wait();
        return None;
    }
    processes
        .lock()
        .expect("native processes lock poisoned")
        .insert(surface.id.clone(), pid);
    drop(current);
    let output = child.wait_with_output().ok()?;
    let mut active = processes.lock().expect("native processes lock poisoned");
    if active.get(&surface.id) == Some(&pid) {
        active.remove(&surface.id);
    }
    drop(active);
    if !is_current(&surface.id, generation, generations) {
        return None;
    }
    if !output.status.success() {
        eprintln!(
            "native AppKit renderer failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| eprintln!("invalid native AppKit result: {error}"))
        .ok()
}

fn post_control(
    client: &Client,
    base_url: &str,
    surface: &Surface,
    control: &Control,
    values: Map<String, Value>,
) {
    let control_id = control.id.as_deref().unwrap_or(&control.kind);
    let action = if control.kind == "link" {
        if let Some(url) = control.url.as_deref() {
            open_url(url);
        }
        json!({ "type": "open-url", "url": control.url })
    } else {
        json!({
            "type": "invoke",
            "action": control.action.as_deref().unwrap_or(control_id),
            "payload": values,
        })
    };
    post_event(
        client,
        base_url,
        &HostEvent::ControlActivated {
            surface_id: surface.id.clone(),
            control_id: control_id.to_string(),
            action,
        },
    );
    post_closed(client, base_url, surface, "action");
}

fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).status();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(url).status();
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", url]).status();
    if let Err(error) = result {
        eprintln!("failed to open native UI link: {error}");
    }
}

fn post_changes(client: &Client, base_url: &str, surface: &Surface, values: &Map<String, Value>) {
    let initial = control_values(surface);
    for (control_id, value) in values {
        if initial.get(control_id) == Some(value) {
            continue;
        }
        post_event(
            client,
            base_url,
            &HostEvent::ControlChanged {
                surface_id: surface.id.clone(),
                control_id: control_id.clone(),
                value: value.clone(),
            },
        );
    }
}

fn post_closed(client: &Client, base_url: &str, surface: &Surface, reason: &str) {
    post_event(
        client,
        base_url,
        &HostEvent::SurfaceClosed {
            surface_id: surface.id.clone(),
            reason: reason.to_string(),
        },
    );
}

fn message_buttons(labels: &[String]) -> MessageButtons {
    match labels {
        [] => MessageButtons::Ok,
        [one] => MessageButtons::OkCustom(one.clone()),
        [one, two] => MessageButtons::OkCancelCustom(one.clone(), two.clone()),
        [one, two, three, ..] => {
            MessageButtons::YesNoCancelCustom(one.clone(), two.clone(), three.clone())
        }
    }
}

fn surface_description(surface: &Surface) -> String {
    let mut lines = surface.body.iter().cloned().collect::<Vec<_>>();
    for control in &surface.controls {
        let label = control
            .label
            .as_deref()
            .or(control.id.as_deref())
            .unwrap_or(&control.kind);
        match control.kind.as_str() {
            "text-input" => lines.push(format!(
                "{}: {}",
                label,
                if control.extra.get("secure").and_then(Value::as_bool) == Some(true) {
                    "[secure]"
                } else {
                    control
                        .value
                        .as_ref()
                        .and_then(Value::as_str)
                        .or(control.placeholder.as_deref())
                        .unwrap_or_default()
                }
            )),
            "select" => {
                let selected = control.value.as_ref().and_then(Value::as_str);
                let value = control
                    .options
                    .iter()
                    .find(|option| Some(option.id.as_str()) == selected)
                    .map(|option| option.label.as_str())
                    .or(selected)
                    .unwrap_or_default();
                lines.push(format!("{label}: {value}"));
            }
            "checkbox" => lines.push(format!(
                "{} {}",
                if control.checked == Some(true) {
                    "[x]"
                } else {
                    "[ ]"
                },
                label
            )),
            "progress" => {
                let percent = control
                    .value
                    .as_ref()
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    * 100.0;
                lines.push(format!(
                    "{}: {:.0}%{}",
                    label,
                    percent,
                    control
                        .detail
                        .as_deref()
                        .map(|detail| format!(" - {detail}"))
                        .unwrap_or_default()
                ));
            }
            "metric" => lines.push(format!(
                "{}: {}{}",
                label,
                control
                    .value
                    .as_ref()
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                control
                    .detail
                    .as_deref()
                    .map(|detail| format!(" - {detail}"))
                    .unwrap_or_default()
            )),
            "section" => lines.push(format!(
                "{}{}",
                label,
                control
                    .detail
                    .as_deref()
                    .map(|detail| format!(" - {detail}"))
                    .unwrap_or_default()
            )),
            "separator" => lines.push("--------".to_string()),
            _ => {}
        }
    }
    lines.join("\n")
}

fn control_values(surface: &Surface) -> serde_json::Map<String, Value> {
    surface
        .controls
        .iter()
        .filter_map(|control| {
            let value = match control.kind.as_str() {
                "text-input" | "select" => control.value.clone(),
                "checkbox" => control.checked.map(Value::Bool),
                _ => None,
            }?;
            Some((control.id.clone()?, value))
        })
        .collect()
}

fn apple_script_string(value: &str) -> String {
    format!("{:?}", value)
}

fn selected_index(result: &MessageDialogResult, labels: &[String]) -> Option<usize> {
    match result {
        MessageDialogResult::Custom(label) => {
            labels.iter().position(|candidate| candidate == label)
        }
        MessageDialogResult::Ok | MessageDialogResult::Yes => (!labels.is_empty()).then_some(0),
        MessageDialogResult::No => (labels.len() > 1).then_some(1),
        MessageDialogResult::Cancel => (labels.len() > 2).then_some(2),
    }
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
            id: Some("deploy".into()),
            label: Some("Deploy".into()),
            action: None,
            url: None,
            value: None,
            placeholder: None,
            checked: None,
            detail: None,
            options: Vec::new(),
            disabled: false,
            destructive: false,
            extra: Map::new(),
        };
        assert_eq!(
            selected_control(&[&control], &MessageDialogResult::Custom("Deploy".into()))
                .and_then(|item| item.id.as_deref()),
            Some("deploy")
        );
    }

    #[test]
    fn parses_all_control_data_and_optional_separator_id() {
        let surface: Surface = serde_json::from_value(json!({
            "id": "review",
            "kind": "dialog",
            "title": "Review",
            "body": "Ready",
            "durationMs": 250,
            "controls": [
                { "type": "text-input", "id": "name", "label": "Name", "value": "Nik", "secure": true, "multiline": true, "required": true },
                { "type": "select", "id": "env", "label": "Environment", "value": "prod", "options": [{ "id": "prod", "label": "Production" }] },
                { "type": "checkbox", "id": "tests", "label": "Run tests", "checked": true },
                { "type": "progress", "id": "build", "label": "Build", "value": 0.75, "detail": "Compiling" },
                { "type": "metric", "id": "checks", "label": "Checks", "value": "17 / 17", "detail": "Passing", "tone": "success" },
                { "type": "section", "id": "workspace", "label": "Workspace", "detail": "Review changes" },
                { "type": "separator" }
            ]
        }))
        .expect("surface should parse");

        assert_eq!(surface.duration_ms, Some(250));
        let roundtrip = serde_json::to_value(&surface).expect("surface should serialize");
        assert_eq!(roundtrip["controls"][0]["secure"], true);
        assert_eq!(roundtrip["controls"][0]["multiline"], true);
        assert_eq!(roundtrip["controls"][0]["required"], true);
        assert_eq!(
            surface_description(&surface),
            "Ready\nName: [secure]\nEnvironment: Production\n[x] Run tests\nBuild: 75% - Compiling\nChecks: 17 / 17 - Passing\nWorkspace - Review changes\n--------"
        );
        assert_eq!(roundtrip["controls"][4]["tone"], "success");
        assert_eq!(
            control_values(&surface),
            serde_json::from_value(json!({
                "name": "Nik",
                "env": "prod",
                "tests": true
            }))
            .expect("control values should parse")
        );
    }

    #[test]
    fn maps_three_native_menu_results() {
        let labels = vec!["Open".into(), "Save".into(), "Close".into()];
        assert_eq!(selected_index(&MessageDialogResult::Yes, &labels), Some(0));
        assert_eq!(selected_index(&MessageDialogResult::No, &labels), Some(1));
        assert_eq!(
            selected_index(&MessageDialogResult::Cancel, &labels),
            Some(2)
        );
    }

    #[test]
    fn parses_appkit_results_and_serializes_change_events() {
        let result: NativeResult = serde_json::from_value(json!({
            "buttonIndex": 1,
            "values": { "name": "Updated", "tests": true }
        }))
        .expect("native result should parse");
        assert_eq!(result.button_index, Some(1));
        assert_eq!(result.values.get("name"), Some(&json!("Updated")));

        let event = HostEvent::ControlChanged {
            surface_id: "form".into(),
            control_id: "name".into(),
            value: json!("Updated"),
        };
        assert_eq!(
            serde_json::to_value(event).expect("event should serialize"),
            json!({
                "type": "control-changed",
                "surfaceId": "form",
                "controlId": "name",
                "value": "Updated"
            })
        );
    }

    #[test]
    fn invalidates_replaced_presentations() {
        let generations = Arc::new(Mutex::new(HashMap::from([(
            "progress".into(),
            "generation-1".into(),
        )])));
        let processes = Arc::new(Mutex::new(HashMap::new()));
        assert!(is_current("progress", "generation-1", &generations));
        cancel_presentation("progress", &generations, &processes);
        assert!(!is_current("progress", "generation-1", &generations));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn uses_real_liquid_glass_with_visual_effect_fallback() {
        assert!(MACOS_DIALOG_SCRIPT.contains("NSGlassEffectView"));
        assert!(MACOS_DIALOG_SCRIPT.contains("NSVisualEffectView"));
        assert!(MACOS_DIALOG_SCRIPT.contains("effectIsInteractive"));
        assert!(MACOS_DIALOG_SCRIPT.contains("surface.layout === \"dashboard\""));
        assert!(MACOS_DIALOG_SCRIPT.contains("metricColumns"));
        assert!(MACOS_DIALOG_SCRIPT.contains("card.cornerRadius = 16"));
    }
}
