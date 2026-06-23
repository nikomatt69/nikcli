import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";

/**
 * Cross-platform desktop "computer use" driver — screenshots plus synthetic
 * mouse / keyboard input, in the spirit of Anthropic's computer-use tool.
 *
 * It shells out to native, already-present tooling where possible and degrades
 * gracefully with an actionable error when an optional helper is missing:
 *   - macOS:  `screencapture` + System Events, with optional `cliclick` for
 *             cursor-only movement and drag operations.
 *   - Linux:  `scrot` / `import` / `gnome-screenshot` + `xdotool`.
 *   - Windows: PowerShell + .NET (built in).
 */
export namespace Computer {
  export type Point = { x: number; y: number };
  export type MouseButton = "left" | "right" | "middle";

  export type Capabilities = {
    platform: NodeJS.Platform;
    screenshot: boolean;
    input: boolean;
    detail: string;
  };

  async function run(
    cmd: string[],
    options?: { input?: string },
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(cmd, {
      stdin: options?.input
        ? new TextEncoder().encode(options.input)
        : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  async function has(bin: string): Promise<boolean> {
    const probe = os.platform() === "win32" ? ["where", bin] : ["which", bin];
    try {
      const { code } = await run(probe);
      return code === 0;
    } catch {
      return false;
    }
  }

  export async function capabilities(): Promise<Capabilities> {
    const platform = os.platform();
    if (platform === "darwin") {
      const cliclick = await has("cliclick");
      return {
        platform,
        screenshot: true,
        input: true,
        detail: cliclick
          ? "macOS: screencapture + System Events + cliclick"
          : "macOS: screencapture + System Events (mouse move/drag need optional cliclick)",
      };
    }
    if (platform === "linux") {
      const xdotool = await has("xdotool");
      const shot =
        (await has("scrot")) ||
        (await has("import")) ||
        (await has("gnome-screenshot"));
      return {
        platform,
        screenshot: shot,
        input: xdotool,
        detail: `linux: ${shot ? "screenshot ok" : "install scrot/imagemagick/gnome-screenshot"}, ${
          xdotool ? "xdotool ok" : "install xdotool for input"
        }`,
      };
    }
    if (platform === "win32") {
      return {
        platform,
        screenshot: true,
        input: true,
        detail: "windows: PowerShell + .NET",
      };
    }
    return {
      platform,
      screenshot: false,
      input: false,
      detail: `unsupported platform: ${platform}`,
    };
  }

  /** Capture the primary screen; returns base64 PNG. */
  export async function screenshot(): Promise<string> {
    const platform = os.platform();
    const dir = await mkdtemp(path.join(os.tmpdir(), "nikcli-shot-"));
    const file = path.join(dir, "screen.png");
    try {
      if (platform === "darwin") {
        const { code, stderr } = await run([
          "screencapture",
          "-x",
          "-t",
          "png",
          file,
        ]);
        if (code !== 0) throw new Error(`screencapture failed: ${stderr}`);
      } else if (platform === "linux") {
        if (await has("scrot")) {
          const { code, stderr } = await run(["scrot", "-o", file]);
          if (code !== 0) throw new Error(`scrot failed: ${stderr}`);
        } else if (await has("gnome-screenshot")) {
          const { code, stderr } = await run(["gnome-screenshot", "-f", file]);
          if (code !== 0) throw new Error(`gnome-screenshot failed: ${stderr}`);
        } else if (await has("import")) {
          const { code, stderr } = await run([
            "import",
            "-window",
            "root",
            file,
          ]);
          if (code !== 0) throw new Error(`import failed: ${stderr}`);
        } else {
          throw new Error(
            "No screenshot tool found. Install scrot, imagemagick, or gnome-screenshot.",
          );
        }
      } else if (platform === "win32") {
        const script = [
          "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
          "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;",
          "$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height);",
          "$g=[System.Drawing.Graphics]::FromImage($bmp);",
          "$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size);",
          `$bmp.Save('${file.replace(/\\/g, "\\\\")}',[System.Drawing.Imaging.ImageFormat]::Png);`,
        ].join("");
        const { code, stderr } = await run([
          "powershell",
          "-NoProfile",
          "-Command",
          script,
        ]);
        if (code !== 0)
          throw new Error(`powershell screenshot failed: ${stderr}`);
      } else {
        throw new Error(`Screenshot not supported on ${platform}`);
      }
      const buffer = await readFile(file);
      return buffer.toString("base64");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Logical screen size in pixels. */
  export async function screenSize(): Promise<{
    width: number;
    height: number;
  }> {
    const platform = os.platform();
    if (platform === "darwin") {
      const { stdout } = await run([
        "osascript",
        "-e",
        'tell application "Finder" to get bounds of window of desktop',
      ]);
      const parts = stdout
        .trim()
        .split(",")
        .map((p) => parseInt(p.trim(), 10));
      if (parts.length === 4 && !Number.isNaN(parts[2]!))
        return { width: parts[2]!, height: parts[3]! };
    }
    if (platform === "linux" && (await has("xdotool"))) {
      const { stdout } = await run(["xdotool", "getdisplaygeometry"]);
      const [w, h] = stdout
        .trim()
        .split(/\s+/)
        .map((p) => parseInt(p, 10));
      if (w && h) return { width: w, height: h };
    }
    if (platform === "win32") {
      const { stdout } = await run([
        "powershell",
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $s=[System.Windows.Forms.SystemInformation]::VirtualScreen; Write-Output ($s.Width.ToString()+'x'+$s.Height.ToString())",
      ]);
      const [w, h] = stdout
        .trim()
        .split("x")
        .map((p) => parseInt(p, 10));
      if (w && h) return { width: w, height: h };
    }
    // Reasonable fallback.
    return { width: 1280, height: 800 };
  }

  async function macMouse(args: string[]): Promise<void> {
    if (!(await has("cliclick"))) {
      throw new Error(
        "This macOS action needs the optional `cliclick` helper (brew install cliclick).",
      );
    }
    const { code, stderr } = await run(["cliclick", ...args]);
    if (code !== 0) throw new Error(`cliclick failed: ${stderr.trim()}`);
  }

  export async function moveMouse(point: Point): Promise<void> {
    const platform = os.platform();
    if (platform === "darwin") {
      return macMouse([`m:${Math.round(point.x)},${Math.round(point.y)}`]);
    }
    if (platform === "linux") {
      const { code, stderr } = await run([
        "xdotool",
        "mousemove",
        String(Math.round(point.x)),
        String(Math.round(point.y)),
      ]);
      if (code !== 0) throw new Error(`xdotool mousemove failed: ${stderr}`);
      return;
    }
    if (platform === "win32") {
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(point.x)}, ${Math.round(point.y)})`;
      const { code, stderr } = await run([
        "powershell",
        "-NoProfile",
        "-Command",
        script,
      ]);
      if (code !== 0) throw new Error(`powershell mousemove failed: ${stderr}`);
      return;
    }
    throw new Error(`mouse move not supported on ${platform}`);
  }

  export async function click(
    point: Point | undefined,
    button: MouseButton = "left",
    double = false,
  ): Promise<void> {
    const platform = os.platform();
    if (platform === "darwin") {
      if (await has("cliclick")) {
        const suffix = point
          ? `:${Math.round(point.x)},${Math.round(point.y)}`
          : ":.";
        const verb = button === "right" ? "rc" : double ? "dc" : "c";
        return macMouse([`${verb}${suffix}`]);
      }
      if (!point)
        throw new Error(
          "A coordinate is required when cliclick is not installed.",
        );
      if (button === "middle")
        throw new Error(
          "Middle click on macOS needs the optional cliclick helper.",
        );
      const count = double ? 2 : 1;
      const modifierDown = button === "right" ? "key down control\n" : "";
      const modifierUp = button === "right" ? "\nkey up control" : "";
      const clicks = Array.from(
        { length: count },
        () => `click at {${Math.round(point.x)}, ${Math.round(point.y)}}`,
      ).join("\ndelay 0.08\n");
      const script = `tell application "System Events"
${modifierDown}${clicks}${modifierUp}
end tell`;
      const { code, stderr } = await run(["osascript", "-e", script]);
      if (code !== 0)
        throw new Error(`System Events click failed: ${stderr.trim()}`);
      return;
    }
    if (point) await moveMouse(point);
    if (platform === "linux") {
      const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
      const args = [
        "xdotool",
        "click",
        ...(double ? ["--repeat", "2"] : []),
        btn,
      ];
      const { code, stderr } = await run(args);
      if (code !== 0) throw new Error(`xdotool click failed: ${stderr}`);
      return;
    }
    if (platform === "win32") {
      // mouse_event flags: left down/up 0x2/0x4, right down/up 0x8/0x10
      const flags = button === "right" ? [0x8, 0x10] : [0x2, 0x4];
      const seq = double ? [...flags, ...flags] : flags;
      const script =
        "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);' -Name U -Namespace W; " +
        seq.map((f) => `[W.U]::mouse_event(${f},0,0,0,0)`).join("; ");
      const { code, stderr } = await run([
        "powershell",
        "-NoProfile",
        "-Command",
        script,
      ]);
      if (code !== 0) throw new Error(`powershell click failed: ${stderr}`);
      return;
    }
    throw new Error(`click not supported on ${platform}`);
  }

  export async function drag(from: Point, to: Point): Promise<void> {
    const platform = os.platform();
    if (platform === "darwin") {
      return macMouse([
        `dd:${Math.round(from.x)},${Math.round(from.y)}`,
        `du:${Math.round(to.x)},${Math.round(to.y)}`,
      ]);
    }
    if (platform === "linux") {
      await run([
        "xdotool",
        "mousemove",
        String(Math.round(from.x)),
        String(Math.round(from.y)),
      ]);
      await run(["xdotool", "mousedown", "1"]);
      await run([
        "xdotool",
        "mousemove",
        String(Math.round(to.x)),
        String(Math.round(to.y)),
      ]);
      const { code, stderr } = await run(["xdotool", "mouseup", "1"]);
      if (code !== 0) throw new Error(`xdotool drag failed: ${stderr}`);
      return;
    }
    throw new Error(`drag not supported on ${platform}`);
  }

  export async function type(text: string): Promise<void> {
    const platform = os.platform();
    if (platform === "darwin") {
      const { code, stderr } = await run([
        "osascript",
        "-e",
        'on run argv\n  tell application "System Events" to keystroke (item 1 of argv)\nend run',
        "--",
        text,
      ]);
      if (code !== 0) throw new Error(`osascript type failed: ${stderr}`);
      return;
    }
    if (platform === "linux") {
      const { code, stderr } = await run([
        "xdotool",
        "type",
        "--clearmodifiers",
        "--",
        text,
      ]);
      if (code !== 0) throw new Error(`xdotool type failed: ${stderr}`);
      return;
    }
    if (platform === "win32") {
      const escaped = text.replace(/'/g, "''");
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`;
      const { code, stderr } = await run([
        "powershell",
        "-NoProfile",
        "-Command",
        script,
      ]);
      if (code !== 0) throw new Error(`powershell type failed: ${stderr}`);
      return;
    }
    throw new Error(`type not supported on ${platform}`);
  }

  // Maps a friendly key name to xdotool / AppleScript key code conventions.
  const MAC_KEYCODE: Record<string, number> = {
    return: 36,
    enter: 36,
    tab: 48,
    space: 49,
    delete: 51,
    backspace: 51,
    escape: 53,
    esc: 53,
    left: 123,
    right: 124,
    down: 125,
    up: 126,
    home: 115,
    end: 119,
    pageup: 116,
    pagedown: 121,
  };

  export async function key(combo: string): Promise<void> {
    const platform = os.platform();
    const normalized = combo.trim();
    if (platform === "darwin") {
      const single = MAC_KEYCODE[normalized.toLowerCase()];
      if (single !== undefined && !normalized.includes("+")) {
        const { code, stderr } = await run([
          "osascript",
          "-e",
          `tell application "System Events" to key code ${single}`,
        ]);
        if (code !== 0) throw new Error(`osascript key failed: ${stderr}`);
        return;
      }
      // Modifier combos: e.g. "cmd+a", "ctrl+c"
      const parts = normalized.toLowerCase().split("+");
      const target = parts.pop()!;
      const modMap: Record<string, string> = {
        cmd: "command down",
        command: "command down",
        ctrl: "control down",
        control: "control down",
        alt: "option down",
        option: "option down",
        shift: "shift down",
      };
      const mods = parts.map((m) => modMap[m]).filter(Boolean);
      const using = mods.length ? ` using {${mods.join(", ")}}` : "";
      const escapedTarget = target.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const { code, stderr } = await run([
        "osascript",
        "-e",
        `tell application "System Events" to keystroke "${escapedTarget}"${using}`,
      ]);
      if (code !== 0) throw new Error(`osascript key combo failed: ${stderr}`);
      return;
    }
    if (platform === "linux") {
      const xdoCombo = normalized
        .replace(/cmd|command/gi, "super")
        .replace(/\+/g, "+");
      const { code, stderr } = await run([
        "xdotool",
        "key",
        "--clearmodifiers",
        xdoCombo,
      ]);
      if (code !== 0) throw new Error(`xdotool key failed: ${stderr}`);
      return;
    }
    if (platform === "win32") {
      // SendKeys notation: ^ = ctrl, % = alt, + = shift
      const parts = normalized.toLowerCase().split("+");
      const target = parts.pop()!;
      let prefix = "";
      for (const m of parts) {
        if (m === "ctrl" || m === "control") prefix += "^";
        else if (m === "alt") prefix += "%";
        else if (m === "shift") prefix += "+";
      }
      const special: Record<string, string> = {
        enter: "{ENTER}",
        return: "{ENTER}",
        tab: "{TAB}",
        escape: "{ESC}",
        esc: "{ESC}",
        backspace: "{BACKSPACE}",
        delete: "{DELETE}",
        up: "{UP}",
        down: "{DOWN}",
        left: "{LEFT}",
        right: "{RIGHT}",
      };
      const send = prefix + (special[target] ?? target);
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${send.replace(/'/g, "''")}')`;
      const { code, stderr } = await run([
        "powershell",
        "-NoProfile",
        "-Command",
        script,
      ]);
      if (code !== 0) throw new Error(`powershell key failed: ${stderr}`);
      return;
    }
    throw new Error(`key not supported on ${platform}`);
  }

  export async function scroll(
    point: Point | undefined,
    direction: "up" | "down" | "left" | "right",
    amount = 3,
  ): Promise<void> {
    const platform = os.platform();
    if (platform === "darwin") {
      if (point && (await has("cliclick"))) await moveMouse(point);
      const keyCode =
        direction === "up"
          ? 126
          : direction === "down"
            ? 125
            : direction === "left"
              ? 123
              : 124;
      for (let index = 0; index < amount * 3; index++) {
        const { code, stderr } = await run([
          "osascript",
          "-e",
          `tell application "System Events" to key code ${keyCode}`,
        ]);
        if (code !== 0)
          throw new Error(`System Events scroll failed: ${stderr.trim()}`);
      }
      return;
    }
    if (point) await moveMouse(point);
    if (platform === "linux") {
      const btn =
        direction === "up"
          ? "4"
          : direction === "down"
            ? "5"
            : direction === "left"
              ? "6"
              : "7";
      const { code, stderr } = await run([
        "xdotool",
        "click",
        "--repeat",
        String(amount),
        btn,
      ]);
      if (code !== 0) throw new Error(`xdotool scroll failed: ${stderr}`);
      return;
    }
    if (platform === "win32") {
      const delta = direction === "up" ? 120 : direction === "down" ? -120 : 0;
      const script =
        "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);' -Name U2 -Namespace W2; " +
        Array.from(
          { length: amount },
          () => `[W2.U2]::mouse_event(0x800,0,0,${delta},0)`,
        ).join("; ");
      const { code, stderr } = await run([
        "powershell",
        "-NoProfile",
        "-Command",
        script,
      ]);
      if (code !== 0) throw new Error(`powershell scroll failed: ${stderr}`);
      return;
    }
    throw new Error(`scroll not supported on ${platform}`);
  }
}
