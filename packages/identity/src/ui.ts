import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const githubIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12Z"/></svg>`

const mailIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const checkIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

type PageTone = "default" | "success" | "error"

function page(
  c: Context,
  title: string,
  content: string,
  status: ContentfulStatusCode = 200,
  tone: PageTone = "default",
): Response {
  const nonce = crypto.randomUUID().replaceAll("-", "")
  c.header(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  )
  c.header("Referrer-Policy", "no-referrer")
  c.header("X-Content-Type-Options", "nosniff")
  return c.html(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${escape(title)} - nikcli</title><style nonce="${nonce}">
:root{color-scheme:light;--bg:250 249 246;--panel:255 255 255;--border:220 214 200;--text:12 11 10;--muted:110 104 94;--accent:37 99 235;--success:22 163 74;--error:220 38 38;--code:244 242 238;--shadow:10 8 4;--grid-alpha:.35;--wash:0 0 0;--wash-alpha:.04;--radius-sm:6px;--radius-md:10px;--radius-card:16px;--shadow-soft:0 2px 16px -2px rgb(var(--shadow)/.08),0 1px 3px rgb(var(--shadow)/.04);--shadow-strong:0 12px 40px -6px rgb(var(--shadow)/.14),0 4px 12px -2px rgb(var(--shadow)/.06);--shadow-glow:0 4px 20px -3px rgb(var(--accent)/.42);--ease:cubic-bezier(.23,1,.32,1)}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:8 8 9;--panel:13 13 15;--border:32 30 27;--text:242 240 236;--muted:148 144 136;--accent:96 165 250;--success:74 222 128;--error:248 113 113;--code:18 17 16;--shadow:0 0 0;--grid-alpha:.62;--wash:255 255 255;--wash-alpha:.025;--shadow-soft:0 2px 16px -2px rgb(0 0 0/.4),0 1px 3px rgb(0 0 0/.2);--shadow-strong:0 12px 40px -6px rgb(0 0 0/.6),0 4px 12px -2px rgb(0 0 0/.3);--shadow-glow:0 4px 24px -5px rgb(var(--accent)/.32)}}
*{box-sizing:border-box}html{min-width:320px;min-height:100%;background:rgb(var(--bg))}body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:clamp(20px,5vw,48px) 20px;background-color:rgb(var(--bg));background-image:linear-gradient(rgb(var(--border)/var(--grid-alpha)) 1px,transparent 1px),linear-gradient(90deg,rgb(var(--border)/var(--grid-alpha)) 1px,transparent 1px),radial-gradient(ellipse 900px 600px at 92% 4%,rgb(var(--accent)/.07),transparent 58%),radial-gradient(ellipse 800px 540px at 5% 105%,rgb(var(--wash)/var(--wash-alpha)),transparent 64%);background-size:48px 48px,48px 48px,100%,100%;color:rgb(var(--text));font-family:"Figtree","Avenir Next",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.6;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}.page-shell{width:min(100%,440px);animation:enter .55s var(--ease) both}.brand{position:relative;z-index:0;display:inline-flex;align-items:center;margin:0 0 22px 5px;color:rgb(var(--text));text-decoration:none;transition:opacity .15s ease}.brand:hover{opacity:.82}.brand-word{position:relative;font-family:"Syne","Arial Black",system-ui,sans-serif;font-size:22px;font-weight:800;line-height:1;letter-spacing:-.055em}.brand-word:before,.brand-word:after{content:attr(data-word);position:absolute;inset:0;z-index:-1;color:transparent;-webkit-text-stroke:1px rgb(var(--muted)/.48)}.brand-word:before{transform:translate(2px,2px)}.brand-word:after{transform:translate(4px,4px);opacity:.55}.brand-domain{margin-left:10px;padding-left:10px;border-left:1px solid rgb(var(--border));color:rgb(var(--muted));font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.card{position:relative;overflow:hidden;padding:clamp(24px,6vw,32px);border:1px solid rgb(var(--border));border-radius:var(--radius-card);background:rgb(var(--panel)/.96);box-shadow:var(--shadow-strong)}.card:before{content:"";position:absolute;inset:0 24px auto;height:1px;background:rgb(255 255 255/.7)}.card:after{content:"";position:absolute;width:180px;height:180px;right:-90px;top:-110px;border-radius:999px;background:rgb(var(--accent)/.09);filter:blur(34px);pointer-events:none}.eyebrow{position:relative;display:flex;align-items:center;gap:8px;margin-bottom:13px;color:rgb(var(--accent));font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;line-height:1;letter-spacing:.18em;text-transform:uppercase}.eyebrow-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px rgb(var(--accent)/.12)}h1{position:relative;margin:0;color:rgb(var(--text));font-family:"Syne","Avenir Next",system-ui,sans-serif;font-size:clamp(26px,7vw,32px);font-weight:750;line-height:1.08;letter-spacing:-.035em}.body{position:relative;margin-top:14px}.body>p:first-child{margin-top:0}.body p{margin:0 0 22px;color:rgb(var(--muted));font-size:14px;line-height:1.7}.stack{display:grid;gap:14px}.or{display:flex;align-items:center;gap:12px;color:rgb(var(--muted));font-size:10px;font-weight:700;line-height:1;text-transform:uppercase;letter-spacing:.18em}.or:before,.or:after{content:"";height:1px;flex:1;background:rgb(var(--border))}form{margin:0}label{display:block;color:rgb(var(--text));font-size:12px;font-weight:700;line-height:1;text-transform:uppercase;letter-spacing:.13em}input{width:100%;height:46px;padding:0 14px;border:1px solid rgb(var(--border));border-radius:var(--radius-md);outline:0;background:rgb(var(--bg));color:rgb(var(--text));font:14px "Figtree","Avenir Next",Inter,system-ui,sans-serif;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}input:hover{border-color:rgb(var(--muted)/.55)}input:focus{border-color:rgb(var(--accent));box-shadow:0 0 0 3px rgb(var(--accent)/.18);background:rgb(var(--panel))}input::placeholder{color:rgb(var(--muted)/.58)}button,.button{display:inline-flex;width:100%;min-height:46px;align-items:center;justify-content:center;gap:9px;padding:11px 16px;border:1px solid rgb(var(--accent)/.25);border-radius:var(--radius-md);background:rgb(var(--accent));color:rgb(var(--bg));text-decoration:none;text-align:center;font:700 14px "Figtree","Avenir Next",Inter,system-ui,sans-serif;cursor:pointer;box-shadow:var(--shadow-glow);transition:transform .15s ease,opacity .15s ease,background-color .15s ease,border-color .15s ease,box-shadow .15s ease}button:hover,.button:hover{opacity:.9;transform:translateY(-1px)}button:active,.button:active{transform:scale(.97)}button:focus-visible,.button:focus-visible,input:focus-visible,.brand:focus-visible{outline:2px solid rgb(var(--accent));outline-offset:3px}.button svg,button svg{width:17px;height:17px;flex:none}.secondary{border-color:rgb(var(--border));background:rgb(var(--panel));color:rgb(var(--text));box-shadow:var(--shadow-soft)}.secondary:hover{border-color:rgb(var(--accent)/.48);background:rgb(var(--code));opacity:1}.danger{border-color:rgb(var(--error)/.3);background:rgb(var(--error)/.1);color:rgb(var(--error));box-shadow:none}.danger:hover{background:rgb(var(--error)/.16);opacity:1}.code{height:58px;text-align:center;font:700 clamp(21px,7vw,27px) "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.2em;font-variant-numeric:tabular-nums}.notice{margin:0 0 20px;padding:11px 13px;border:1px solid rgb(var(--error)/.28);border-radius:var(--radius-md);background:rgb(var(--error)/.09);color:rgb(var(--error));font-size:13px;line-height:1.55}.result{display:grid;place-items:center;width:46px;height:46px;margin:4px 0 18px;border:1px solid rgb(var(--accent)/.22);border-radius:var(--radius-md);background:rgb(var(--accent)/.1);color:rgb(var(--accent))}.result.success{border-color:rgb(var(--success)/.24);background:rgb(var(--success)/.1);color:rgb(var(--success))}.result.error{border-color:rgb(var(--error)/.24);background:rgb(var(--error)/.1);color:rgb(var(--error))}.result svg{width:23px;height:23px}.footer{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:18px;color:rgb(var(--muted));font-size:11px;font-weight:600;letter-spacing:.02em}.secure-dot{width:6px;height:6px;border-radius:50%;background:rgb(var(--success))}@keyframes enter{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}@media(max-width:480px){body{align-items:flex-start;padding:28px 14px}.page-shell{margin:auto 0}.card{padding:24px 20px}.brand{margin-left:3px}.brand-domain{font-size:10px}.code{letter-spacing:.14em}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style></head><body><div class="page-shell"><a class="brand" href="https://nikcli.store" aria-label="nikcli home"><span class="brand-word" data-word="NIKCLI">NIKCLI</span><span class="brand-domain">identity</span></a><main class="card" data-tone="${tone}"><header><div class="eyebrow"><span class="eyebrow-dot"></span>secure account gateway</div><h1>${escape(title)}</h1></header><div class="body">${content}</div></main><footer class="footer"><span class="secure-dot"></span>Encrypted sign-in for nikcli</footer></div></body></html>`,
    status,
  )
}

export function loginPage(c: Context, loginState: string, message?: string): Response {
  const note = message
    ? `<div class="notice" role="alert">${escape(message)}</div>`
    : "<p>Continue to the nikcli web app, Studio, or CLI without sharing a password. If this is your first time, your account will be created automatically after verification.</p>"
  return page(
    c,
    "Sign in or create an account",
    `${note}<div class="stack"><a class="button secondary" href="/login/github?login_state=${encodeURIComponent(loginState)}">${githubIcon}Continue with GitHub</a><div class="or">or use email</div><form class="stack" method="post" action="/login/email/request"><input type="hidden" name="login_state" value="${escape(loginState)}"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required><button type="submit">${mailIcon}Email me a code</button></form></div>`,
  )
}

export function emailCodePage(c: Context, loginState: string, email: string, message?: string): Response {
  const note = message
    ? `<div class="notice" role="alert">${escape(message)}</div>`
    : `<p>Enter the six-digit code sent to <strong>${escape(email)}</strong>. The code expires shortly.</p>`
  return page(
    c,
    "Check your email",
    `${note}<form class="stack" method="post" action="/login/email/verify"><input type="hidden" name="login_state" value="${escape(loginState)}"><label for="code">Verification code</label><input class="code" id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" required autofocus><button type="submit">${checkIcon}Verify and continue</button></form>`,
  )
}

export function devicePage(c: Context, userCode = "", message?: string): Response {
  const note = message
    ? `<div class="notice" role="alert">${escape(message)}</div>`
    : "<p>Enter the code shown in your terminal. Only approve a device you recognize.</p>"
  return page(
    c,
    "Connect a device",
    `${note}<form class="stack" method="post" action="/device"><label for="user_code">Device code</label><input class="code" id="user_code" name="user_code" value="${escape(userCode)}" maxlength="9" autocomplete="one-time-code" placeholder="0000-0000" required autofocus><button name="decision" value="approve" type="submit">${checkIcon}Approve device</button><button class="danger" name="decision" value="deny" type="submit">Deny request</button></form>`,
  )
}

export function resultPage(c: Context, title: string, message: string, status: ContentfulStatusCode = 200): Response {
  const tone: PageTone = status >= 400 ? "error" : "success"
  const icon =
    tone === "success"
      ? checkIcon
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3.5v.01M12 3l9 17H3L12 3Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return page(c, title, `<div class="result ${tone}">${icon}</div><p>${escape(message)}</p>`, status, tone)
}
