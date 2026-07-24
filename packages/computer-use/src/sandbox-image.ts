import { createHash } from "node:crypto";

/**
 * Self-contained Linux desktop image for the background "computer use" sandbox.
 *
 * The assets are embedded as strings (not files) so they survive bundling and
 * are written to a throwaway build context at runtime. The image boots a
 * virtual X display, a lightweight window manager, a VNC server, and noVNC so
 * the desktop can be driven headlessly while still offering an optional live
 * preview over HTTP — never touching the host screen.
 */
export namespace SandboxImage {
  export const NAME = "nikcli-computer-sandbox";

  export const DEFAULT_WIDTH = 1280;
  export const DEFAULT_HEIGHT = 800;

  /** noVNC web port inside the container. */
  export const VNC_PORT = 6080;

  export const DOCKERFILE = `FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \\
      xvfb \\
      x11vnc \\
      fluxbox \\
      xdotool \\
      scrot \\
      imagemagick \\
      novnc \\
      websockify \\
      x11-utils \\
      dbus-x11 \\
      firefox-esr \\
      fonts-dejavu \\
      fonts-liberation \\
      ca-certificates \\
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV DISPLAY=:99 SCREEN_W=${DEFAULT_WIDTH} SCREEN_H=${DEFAULT_HEIGHT} SCREEN_D=24

EXPOSE ${VNC_PORT}

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
`;

  export const ENTRYPOINT = `#!/usr/bin/env bash
set -euo pipefail

: "\${SCREEN_W:=${DEFAULT_WIDTH}}"
: "\${SCREEN_H:=${DEFAULT_HEIGHT}}"
: "\${SCREEN_D:=24}"
: "\${DISPLAY:=:99}"

rm -f /tmp/.X*-lock /tmp/.X11-unix/X* 2>/dev/null || true

Xvfb "\$DISPLAY" -screen 0 "\${SCREEN_W}x\${SCREEN_H}x\${SCREEN_D}" -ac +extension RANDR +extension GLX >/dev/null 2>&1 &

for _ in \$(seq 1 100); do
  if xdpyinfo -display "\$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 0.1
done

fluxbox >/dev/null 2>&1 &
x11vnc -display "\$DISPLAY" -forever -shared -nopw -rfbport 5900 -quiet >/dev/null 2>&1 &
websockify --web=/usr/share/novnc ${VNC_PORT} localhost:5900 >/dev/null 2>&1 &

# Stay up as long as the virtual display is alive; if it dies, exit so the
# session manager can recreate the container.
wait -n
`;

  /**
   * Content-addressed image tag. Any change to the Dockerfile or entrypoint
   * yields a new tag, so {@link ensureImage} rebuilds instead of reusing stale
   * layers.
   */
  export const TAG = `${NAME}:${createHash("sha256")
    .update(DOCKERFILE)
    .update("")
    .update(ENTRYPOINT)
    .digest("hex")
    .slice(0, 12)}`;
}
