# Nikcli sul telefono via Tailscale (Option B)

Questa guida ti porta da zero ad avere Nikcli utilizzabile dal browser del tuo telefono, collegandoti in modo privato tramite Tailscale (nessuna porta esposta su Internet).

Obiettivo finale

- Apri un URL `https://...ts.net` dal telefono (Safari/Chrome).
- Vedi la web UI di Nikcli.
- Il telefono parla con il Nikcli server remoto (API) tramite Tailscale.
- Autenticazione passwordless: l'accesso e' concesso solo se la richiesta arriva da Tailscale Serve e (opzionale) se l'utente Tailscale e' in allowlist.

Architettura (Option B)

```
Telefono (Tailscale ON)
  |
  | HTTPS 443  -> Web UI (Vite preview o static)
  | HTTPS 8443 -> Nikcli API (Hono/Bun)
  v
Tailscale Serve sul nodo host
  |
  | proxy verso 127.0.0.1
  v
Host (workspace e processi)
  - Web UI locale:  http://127.0.0.1:3002
  - Nikcli API:     http://127.0.0.1:4096
```

Perche' Option B

- Funziona bene su mobile.
- Mantiene API e UI separate (utile per debug e upgrade).
- Non richiede reverse proxy esterni.

Porte usate

- UI locale (host): `3002` (solo loopback)
- API locale (host): `4096` (solo loopback)
- UI esposta nel tailnet: `443` (HTTPS)
- API esposta nel tailnet: `8443` (HTTPS)

Prerequisiti

- Un "host" sempre acceso (Mac/Linux/VM) dove risiede il tuo workspace.
- Tailscale installato su host e telefono.
- Nikcli disponibile sull'host (binario installato o repo).
- Bun sull'host se vuoi buildare la web UI dal repo.

Indice (leggi in ordine)

- `docs/tailscale-mobile/01-tailscale-setup.md`
- `docs/tailscale-mobile/02-host-setup.md`
- `docs/tailscale-mobile/03-phone-and-serve.md`

Security note (importante)

- Nikcli puo' leggere/scrivere file ed eseguire comandi sul tuo host.
- Non usare Funnel.
- Se il tailnet non e' solo tuo, configura ACL Tailscale e/o `NIKCLI_SERVER_TAILSCALE_USERS`.
