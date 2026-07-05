import { render } from "solid-js/web"
import { MetaProvider } from "@solidjs/meta"
import "@nikcli-ai/app/index.css"
import { Font } from "@nikcli-ai/ui/font"
import { Splash } from "@nikcli-ai/ui/logo"
import "./styles.css"
import { createSignal, Match, onMount } from "solid-js"
import { commands, events, InitStep } from "./bindings"
import { Channel } from "@tauri-apps/api/core"
import { Switch } from "solid-js"

const root = document.getElementById("root")!

render(() => {
  let splash!: SVGSVGElement
  const [state, setState] = createSignal<InitStep | null>(null)

  const channel = new Channel<InitStep>()
  channel.onmessage = (e) => setState(e)
  commands.awaitInitialization(channel as any).then(() => {
    const currentOpacity = getComputedStyle(splash).opacity

    splash.style.animation = "none"
    splash.style.animationPlayState = "paused"
    splash.style.opacity = currentOpacity

    requestAnimationFrame(() => {
      splash.style.transition = "opacity 0.3s ease"
      requestAnimationFrame(() => {
        splash.style.opacity = "1"
      })
    })
  })

  return (
    <MetaProvider>
      <div class="w-screen h-screen bg-background-base flex items-center justify-center overflow-hidden relative">
        <Font />
        {/* Ambient glow orbs matching web design */}
        <div
          class="absolute pointer-events-none"
          style="width:700px;height:500px;left:50%;top:50%;transform:translate(-50%,-50%);background:radial-gradient(ellipse 700px 500px at 50% 50%, color-mix(in srgb, var(--icon-interactive-base, #2563EB) 6%, transparent), transparent 70%);filter:blur(60px)"
        />
        <div class="flex flex-col items-center gap-8 relative z-10">
          <div class="relative">
            {/* Glow ring behind logo */}
            <div
              class="absolute inset-0 rounded-full animate-[pulse-splash_2s_ease-in-out_infinite]"
              style="background:radial-gradient(circle, color-mix(in srgb, var(--icon-interactive-base, #2563EB) 15%, transparent), transparent 70%);transform:scale(1.8);filter:blur(20px)"
            />
            <Splash ref={splash} class="h-20 relative z-10 animate-[pulse-splash_2s_ease-in-out_infinite]" />
          </div>
          <div class="flex flex-col items-center gap-3">
            <span class="text-text-base text-sm font-medium tracking-wide">
              <Switch fallback="Just a moment...">
                <Match when={state()?.phase === "done"}>
                  {(_) => {
                    onMount(() => {
                      setTimeout(() => events.loadingWindowComplete.emit(null), 1000)
                    })

                    return "All done"
                  }}
                </Match>
                <Match when={state()?.phase === "sqlite_waiting"}>
                  {(_) => {
                    const textItems = [
                      "Just a moment...",
                      "Migrating your database",
                      "This could take a couple of minutes",
                    ]
                    const [textIndex, setTextIndex] = createSignal(0)

                    onMount(async () => {
                      await new Promise((res) => setTimeout(res, 3000))
                      setTextIndex(1)
                      await new Promise((res) => setTimeout(res, 6000))
                      setTextIndex(2)
                    })

                    return <>{textItems[textIndex()]}</>
                  }}
                </Match>
              </Switch>
            </span>
            {/* Pinging status indicator matching web design */}
            <span class="relative flex items-center justify-center w-3 h-3">
              <span
                class="absolute inline-flex w-full h-full rounded-full opacity-75 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]"
                style="background-color: var(--icon-interactive-base, #2563EB)"
              />
              <span
                class="relative inline-flex w-2 h-2 rounded-full"
                style="background-color: var(--icon-interactive-base, #2563EB)"
              />
            </span>
          </div>
        </div>
      </div>
    </MetaProvider>
  )
}, root)
