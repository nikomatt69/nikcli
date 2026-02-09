# 02 - Setup host (Nikcli server + Web UI)

In questa sezione avvii i due processi sull'host:

- Nikcli API server (loopback)
- Web UI (loopback)

Nota importante

- Con auth Tailscale attiva e senza password, le chiamate locali dirette a `127.0.0.1:4096` (senza header Tailscale) rispondono 401. E' normale.

## 1) Prerequisiti sull'host

Verifica binari:

```bash
tailscale version
nikcli --version || true
bun --version || true
```

Se `nikcli` non e' nel PATH, usa la modalita' repo (vedi sotto) oppure installalo come fai di solito nel tuo ambiente.

## 2) Scegli la directory workspace

Decidi dove vuoi che Nikcli lavori (repo/progetto).

Consiglio:

- avvia `nikcli serve` con working directory uguale al workspace
- cosi' il client mobile non deve impostare `Directory` nelle Settings

Esempio:

```bash
cd /percorso/al/tuo/workspace
pwd
```

## 3) Abilita auth passwordless via Tailscale

Imposta queste env:

```bash
export NIKCLI_SERVER_TAILSCALE_AUTH=1

# Raccomandato: allowlist. Di solito e' la mail con cui fai login a Tailscale.
export NIKCLI_SERVER_TAILSCALE_USERS="tuo-utente@dominio.com"
```

Opzionale (fallback Basic Auth per accessi locali non via Serve):

```bash
export NIKCLI_SERVER_PASSWORD="una_password_forte"
export NIKCLI_SERVER_USERNAME="nikcli"
```

## 4) Avvia Nikcli API server (loopback)

Raccomandato (porta stabile):

```bash
nikcli --print-logs serve --hostname 127.0.0.1 --port 4096
```

Se stai lavorando dal monorepo e vuoi avviare la versione dev:

```bash
cd /percorso/al/monorepo/packages/nikcli
bun run dev -- serve --hostname 127.0.0.1 --port 4096
```

## 5) Avvia la Web UI (packages/app)

Se hai il monorepo:

1. Installa deps (una volta sola):

```bash
cd /percorso/al/monorepo
bun install
```

2. Build + preview:

```bash
cd packages/app
bun run build
bun run preview -- --host 127.0.0.1 --port 3002
```

Nota: `preview` va bene per uso personale. Se vuoi, puoi anche servire `packages/app/dist` con un web server a tua scelta.

## 6) Verifica locale (host)

UI (deve rispondere HTML):

```bash
curl -I http://127.0.0.1:3002
```

API (con Tailscale auth attiva e senza password, e' normale vedere 401):

```bash
curl -i http://127.0.0.1:4096/global/health
```

## 7) (Opzionale) Avvio automatico

Se vuoi che tutto riparta dopo reboot, usa:

- macOS: launchd
- Linux: systemd

Qui non creo file di sistema automaticamente (dipende dal tuo OS e percorsi), ma se mi dici macOS o Linux ti scrivo gli unit/plist completi con i comandi esatti che stai usando.
