# Guida: collegare nikcli a Discord

Percorso predefinito: apri la TUI nikcli → `/discord` → incolla il token → apri l’URL di invito.

Questa guida copre anche il Developer Portal se parti da zero, e il wizard CLI come fallback.

---

## Percorso consigliato (TUI)

1. Avvia nikcli (`bun run dev` in `packages/nikcli`, oppure il binario `nikcli`).
2. Nella TUI lancia **`/discord`**.
3. Incolla il **Bot Token**.
4. Apri l’**invite URL** che compare e autorizza il bot nel server.
5. Nel [Discord Developer Portal](https://discord.com/developers/applications) abilita **Message Content Intent** (Bot → Privileged Gateway Intents).

Fatto. Menziona il bot in un canale (`@nikcli …`): il lavoro continua nel thread.

---

## Parto da zero — Discord Developer Portal (6 click)

1. Apri [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → nome → **Create**.
2. Nel menu a sinistra apri **Bot**.
3. **Reset Token** → copia il token (lo incollerai in `/discord`).
4. Nella stessa pagina, sotto **Privileged Gateway Intents**, abilita **Message Content Intent** → Save.
5. Torna in nikcli, lancia `/discord`, incolla il token.
6. Apri l’invite URL stampato, scegli il server, autorizza.

Non serve un URL pubblico: il bot usa il Gateway websocket in uscita.

Permessi richiesti (già nel bitfield dell’invite URL): View Channel, Send Messages, Add Reactions, Embed Links, Attach Files, Read Message History, Use Application Commands, Send Messages in Threads, Create Public Threads.

---

## Comportamento

- Menzione in un canale → viene creato un **thread**; il lavoro resta lì.
- Nei **DM** il bot risponde sempre.
- In un thread che ha già una sessione nikcli puoi continuare **senza** rimenzionare.
- Le sessioni sono chiavi `canale-thread`, persistite, TTL 1 ora.
- Risposte in streaming (messaggio “Thinking…” aggiornato), spezzate a 2000 caratteri.
- Messaggi vocali / allegati audio → Whisper se `OPENROUTER_API_KEY` è impostata.
- Slash command **`/nikcli-tools`** con `list` | `allow` | `deny` | `reset`.

---

## Risoluzione problemi

### Intent 4014 (Disallowed intents)

Discord chiude il Gateway se manca **Message Content Intent**.

1. Developer Portal → la tua app → **Bot** → Privileged Gateway Intents.
2. Abilita **Message Content Intent** e salva.
3. Riavvia il bot (o rilancia `/discord`).

Niente stack dump: nikcli stampa una checklist breve.

### Lo slash command `/nikcli-tools` non si vede

I comandi globali possono richiedere fino a un’ora. Il bot li registra all’avvio (ready). Prova a:

- aspettare, oppure
- kickare e reinvitare il bot con lo stesso invite URL (scope `applications.commands`).

### 401 dal server nikcli

Username e password Basic Auth (`NIKCLI_USERNAME` / `NIKCLI_PASSWORD`) devono coincidere con il server. Se non imposti `NIKCLI_URL`, questo package avvia un server nikcli locale.

---

## Fallback CLI

Se non usi la TUI:

```bash
cd packages/discord
bun run setup
bun run dev
```

Il wizard (in italiano) chiede il token, opzionalmente `NIKCLI_URL` e `OPENROUTER_API_KEY`, scrive `.env`, verifica il token e stampa l’invite URL + il reminder sull’intent.

Altri comandi: `bun run start`, `bun run typecheck`.
