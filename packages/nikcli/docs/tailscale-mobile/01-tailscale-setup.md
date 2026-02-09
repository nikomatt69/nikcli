# 01 - Setup Tailscale (host + telefono)

Questa sezione configura Tailscale in modo che:

- l'host abbia un nome DNS nel tailnet (`...ts.net`)
- il telefono possa raggiungere l'host in modo privato
- Tailscale Serve possa generare cert HTTPS per il tuo nodo

## 1) Crea (o scegli) il tuo tailnet

1. Vai nella console admin di Tailscale (web).
2. Assicurati di sapere quale account/tailnet userai per i device.

Consiglio: se usi un tailnet condiviso (team/famiglia), pianifica subito ACL (vedi sezione 6).

## 2) Installa Tailscale sull'host

### macOS (consigliato)

1. Installa l'app Tailscale (GUI).
2. Apri l'app e fai login.
3. Verifica da terminale:

```bash
tailscale version
tailscale status
```

### Linux (generico)

1. Installa e avvia Tailscale (metodo ufficiale):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

2. Verifica:

```bash
tailscale version
tailscale status
```

## 3) Installa Tailscale sul telefono

1. Installa l'app Tailscale (iOS/Android).
2. Login con lo stesso tailnet.
3. Attiva la VPN (toggle ON).
4. Verifica che l'host appaia nella lista dei device.

## 4) Abilita MagicDNS (consigliato)

1. Console admin Tailscale -> DNS.
2. Abilita MagicDNS.

Questo ti permette di raggiungere l'host con un nome tipo:
`nome-host.tuo-tailnet.ts.net`

## 5) Abilita HTTPS certificates (Serve)

1. Console admin Tailscale -> DNS.
2. Abilita "HTTPS Certificates" (o voce equivalente).

Serve usa questi cert per esporre `https://...ts.net`.

## 6) (Raccomandato) Configura Access Controls / ACL

Se il tailnet e' solo tuo e i device sono solo i tuoi, puoi anche evitare, ma e' meglio restringere.

Obiettivo minimo:

- solo il tuo utente/device puo' raggiungere questo host

Da console admin Tailscale -> Access controls:

- limita chi puo' connettersi al nodo che userai per Nikcli

Nota: le ACL dipendono molto da come organizzi users/tags. Se vuoi, dimmi se il tuo tailnet e' personale o team e ti scrivo una policy ACL precisa.

## 7) Trova il DNSName del tuo host (ti servira' dopo)

Metodo 1 (piu' semplice)

- apri `tailscale status`
- cerca la riga del tuo host e copia il nome `...ts.net`

Metodo 2 (automatica, senza jq, usando bun)

```bash
tailscale status --json | bun -e 'import { readFileSync } from "fs"; const j = JSON.parse(readFileSync(0, "utf8")); process.stdout.write(j.Self.DNSName.replace(/\.$/, ""))'
```

Salva questo valore: lo userai per aprire la UI dal telefono e per configurare l'API.
