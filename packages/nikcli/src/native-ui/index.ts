import { EventEmitter } from "events";
import {
  SurfaceSchema,
  SurfaceEventSchema,
  type Surface,
  type SurfaceEvent,
} from "@nikcli-ai/native-ui-protocol";

const MAX_SURFACES = 100;

export namespace NativeUI {
  const surfaces = new Map<string, Surface>();
  const events = new EventEmitter();

  export function list(): Surface[] {
    return [...surfaces.values()];
  }

  export function get(id: string): Surface | undefined {
    return surfaces.get(id);
  }

  export function open(input: Surface): Surface {
    const surface = SurfaceSchema.parse(input);
    if (!surfaces.has(surface.id) && surfaces.size >= MAX_SURFACES) {
      throw new Error(`Native UI surface limit reached (${MAX_SURFACES})`);
    }
    surfaces.set(surface.id, surface);
    emit({ type: "surface-opened", surface });
    return surface;
  }

  export function update(input: Surface): Surface {
    const surface = SurfaceSchema.parse(input);
    if (!surfaces.has(surface.id))
      throw new Error(`Native UI surface not found: ${surface.id}`);
    surfaces.set(surface.id, surface);
    emit({ type: "surface-updated", surface });
    return surface;
  }

  export function close(
    id: string,
    reason: "dismissed" | "action" | "replaced" | "system" = "system",
  ): boolean {
    if (!surfaces.delete(id)) return false;
    emit({ type: "surface-closed", surfaceId: id, reason });
    return true;
  }

  export function closeAll(): void {
    for (const id of surfaces.keys()) close(id, "system");
  }

  export function subscribe(
    listener: (event: SurfaceEvent) => void,
  ): () => void {
    events.on("surface", listener);
    return () => events.off("surface", listener);
  }

  export function dispatch(input: SurfaceEvent): SurfaceEvent {
    const event = SurfaceEventSchema.parse(input);
    if (event.type === "surface-closed") surfaces.delete(event.surfaceId);
    events.emit("surface", event);
    return event;
  }

  export function wait(
    predicate: (event: SurfaceEvent) => boolean,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SurfaceEvent> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribe((event) => {
        if (!predicate(event)) return;
        cleanup();
        resolve(event);
      });
      const onAbort = () => {
        cleanup();
        reject(new DOMException("Native UI wait aborted", "AbortError"));
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        unsubscribe();
        options.signal?.removeEventListener("abort", onAbort);
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `Timed out waiting for native UI event after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function emit(event: SurfaceEvent): void {
    events.emit("surface", event);
  }
}
