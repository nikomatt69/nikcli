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

function page(c: Context, title: string, content: string, status: ContentfulStatusCode = 200): Response {
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
<title>${escape(title)} - NikCLI</title><style nonce="${nonce}">
:root{color-scheme:light;--ink:#17221a;--muted:#647067;--line:#d7ddd8;--paper:#f7f4ed;--card:#fffdf8;--accent:#d94d2b;--accent2:#0d7658}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 15%,#f3caa8 0,transparent 32%),radial-gradient(circle at 85% 80%,#b9ddcb 0,transparent 30%),var(--paper);font-family:Georgia,'Times New Roman',serif;color:var(--ink)}main{width:min(100%,440px);padding:34px;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--card) 94%,transparent);box-shadow:0 24px 70px #263c2b1f}header{display:flex;align-items:center;gap:12px;margin-bottom:28px}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--ink);color:white;font:bold 20px ui-monospace,monospace}h1{font-size:27px;line-height:1.1;margin:0}p{color:var(--muted);line-height:1.55}.stack{display:grid;gap:12px}.or{display:flex;align-items:center;gap:10px;color:var(--muted);font:12px ui-sans-serif,sans-serif;text-transform:uppercase;letter-spacing:.12em}.or:before,.or:after{content:'';height:1px;flex:1;background:var(--line)}label{font:600 13px ui-sans-serif,sans-serif}input{width:100%;padding:12px 13px;border:1px solid var(--line);border-radius:9px;background:white;font:15px ui-sans-serif,sans-serif}button,.button{display:block;width:100%;padding:12px 16px;border:0;border-radius:9px;background:var(--accent2);color:white;text-decoration:none;text-align:center;font:700 14px ui-sans-serif,sans-serif;cursor:pointer}.github{background:var(--ink)}.danger{background:var(--accent)}.secondary{background:#e8ece8;color:var(--ink)}.code{text-align:center;font:700 24px ui-monospace,monospace;letter-spacing:.18em}small{color:var(--muted);font:12px ui-sans-serif,sans-serif}</style></head>
<body><main><header><div class="mark">N</div><h1>${escape(title)}</h1></header>${content}</main></body></html>`,
    status,
  )
}

export function loginPage(c: Context, loginState: string, message?: string): Response {
  const note = message ? `<p>${escape(message)}</p>` : "<p>Sign in to continue securely. No password is stored.</p>"
  return page(
    c,
    "Sign in",
    `${note}<div class="stack"><a class="button github" href="/login/github?login_state=${encodeURIComponent(loginState)}">Continue with GitHub</a><div class="or">or</div><form class="stack" method="post" action="/login/email/request"><input type="hidden" name="login_state" value="${escape(loginState)}"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Email me a code</button></form></div>`,
  )
}

export function emailCodePage(c: Context, loginState: string, email: string, message?: string): Response {
  return page(
    c,
    "Check your email",
    `<p>${escape(message ?? `Enter the six-digit code sent to ${email}.`)}</p><form class="stack" method="post" action="/login/email/verify"><input type="hidden" name="login_state" value="${escape(loginState)}"><label for="code">Verification code</label><input class="code" id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required><button type="submit">Verify and continue</button></form>`,
  )
}

export function devicePage(c: Context, userCode = "", message?: string): Response {
  const note = message
    ? `<p>${escape(message)}</p>`
    : "<p>Enter the code shown in your terminal, then approve this device.</p>"
  return page(
    c,
    "Connect a device",
    `${note}<form class="stack" method="post" action="/device"><label for="user_code">Device code</label><input class="code" id="user_code" name="user_code" value="${escape(userCode)}" maxlength="9" autocomplete="one-time-code" required><button name="decision" value="approve" type="submit">Approve device</button><button class="danger" name="decision" value="deny" type="submit">Deny</button></form>`,
  )
}

export function resultPage(c: Context, title: string, message: string, status: ContentfulStatusCode = 200): Response {
  return page(c, title, `<p>${escape(message)}</p>`, status)
}
