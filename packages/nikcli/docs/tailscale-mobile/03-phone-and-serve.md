# 03 - Tailscale Serve (Option B) + configurazione telefono

Questa e' la parte che rende raggiungibili UI e API dal telefono tramite `https://...ts.net`.

## 1) Configura Tailscale Serve sull'host

Esegui sull'host:

```bash
# UI: espone in HTTPS 443 e proxya verso 127.0.0.1:3002
tailscale serve --bg --https=443 3002

# API: espone in HTTPS 8443 e proxya verso 127.0.0.1:4096
tailscale serve --bg --https=8443 4096

tailscale serve status
```

Se in futuro vuoi spegnere tutto:

```bash
tailscale serve off
```

## 2) Trova gli URL corretti

Il comando `tailscale serve status` ti stampa gli URL pubblicati nel tailnet.

In particolare ti servono:

- URL UI: `https://<dnsname>.ts.net`
- URL API: `https://<dnsname>.ts.net:8443`

Se vuoi stampare solo il DNSName con bun:

```bash
tailscale status --json | bun -e 'import { readFileSync } from "fs"; const j = JSON.parse(readFileSync(0, "utf8")); process.stdout.write(j.Self.DNSName.replace(/\.$/, ""))'
```

## 3) Apri la UI dal telefono

1. Sul telefono: apri Tailscale e metti ON.
2. Apri Safari/Chrome.
3. Vai all'URL UI (quello su 443).

Se la pagina non carica:

- verifica che l'host sia online
- verifica `tailscale status` su host e telefono

## 4) Configura la UI per puntare all'API (porta 8443)

Nella web UI:

1. Vai su Settings.
2. In "Server URL" inserisci l'URL API su porta 8443.
3. (Opzionale) "Directory": lascia vuoto per usare la directory di avvio del server, oppure imposta un path specifico.
4. Premi Save.

Se auth Tailscale e' corretta:

- Status diventa Connected
- La sezione Authentication mostra che non serve login

## 5) Test end-to-end

1. Crea una sessione.
2. Invia un prompt.
3. Verifica che i messaggi arrivino in realtime.
4. Se Nikcli chiede permission/question/dbedit, rispondi dalla modale: la sessione deve riprendere.

## 6) Troubleshooting

### A) UI ok, ma API "Disconnected"

Checklist:

- `tailscale serve status` mostra anche la porta 8443?
- il processo `nikcli serve` e' vivo sull'host?
- hai inserito Server URL corretto (porta 8443)?

Test da un altro device nel tailnet:

```bash
curl -i https://DNSNAME:8443/global/health
```

### B) 403 Forbidden

Significa che l'header Tailscale e' presente ma l'utente non e' ammesso.

Azioni:

- controlla `NIKCLI_SERVER_TAILSCALE_USERS`
- ricordati che in genere e' la mail con cui fai login a Tailscale

### C) 401 Unauthorized

Cause tipiche:

- stai chiamando direttamente `http://127.0.0.1:4096` (non passa da Serve)
- `tailscale serve` non e' configurato per 8443/4096
- hai attivato Tailscale auth ma non hai header (Serve non in mezzo)

Soluzioni:

- usa sempre l'URL `https://...:8443` dal telefono
- oppure imposta `NIKCLI_SERVER_PASSWORD` se vuoi anche accesso locale senza header

### D) Errori CORS nel browser

Con Option B l'origin e' `https://DNSNAME.ts.net` e l'API e' su `https://DNSNAME.ts.net:8443`.

In Nikcli ho abilitato automaticamente CORS per `https://*.ts.net` quando:

- `NIKCLI_SERVER_TAILSCALE_AUTH=1`
- il server e' in listen su loopback (`127.0.0.1` / `localhost`)

Se stai usando un origin diverso (custom domain, reverse proxy esterno, ecc.), allora avvia il server con `--cors <origin>`.

### E) SSE (realtime) non aggiorna

Controlla che l'endpoint eventi sia raggiungibile:

```bash
curl -N https://DNSNAME:8443/event
```

Devi vedere una riga iniziale con `server.connected` e poi heartbeat.

## 7) Aggiungi alla Home Screen (esperienza "app")

iOS (Safari): Share -> Add to Home Screen.
Android (Chrome): menu -> Add to Home screen.
