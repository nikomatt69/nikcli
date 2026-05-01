# Piano: rifinitura UI mobile Nikcli

## Obiettivo

Migliorare l'app mobile con un pass di polish UI/UX end-to-end, mantenendo il comportamento esistente e senza cambiare API/core. La priorita scelta e solo polish UI: coerenza visuale, leggibilita, stati vuoti/caricamento/errore, microinterazioni, accessibilita e resa mobile.

## Vincoli

- Non riscrivere l'architettura: preservare Expo Router, NativeWind, store Zustand, client esistente e flussi gia funzionanti.
- Non introdurre modifiche backend in `packages/nikcli` per questo pass; usare il core solo per rendere piu chiari i concetti gia esposti nell'app.
- Seguire il design language gia presente: superfici glass, radius ampi, palette azzurra light, dark mode sobria, cards operative.
- Evitare nuove dipendenze se non strettamente necessarie.

## File principali

- Shell/nav: `packages/mobile/app/_layout.tsx`, `packages/mobile/app/(app)/_layout.tsx`, `packages/mobile/components/layout/AppHeader.tsx`, `packages/mobile/components/layout/AppTabBar.tsx`, `packages/mobile/components/layout/DrawerMenu.tsx`, `packages/mobile/components/layout/navigation.config.ts`
- Foundation UI: `packages/mobile/lib/theme.ts`, `packages/mobile/lib/animation.ts`, `packages/mobile/components/ui/SurfaceCard.tsx`, `packages/mobile/components/ui/ActionButton.tsx`, `packages/mobile/components/ui/TextField.tsx`, `packages/mobile/components/ui/InfoChip.tsx`, `packages/mobile/components/ui/EmptyState.tsx`, `packages/mobile/components/ui/ErrorBanner.tsx`, `packages/mobile/components/Skeleton.tsx`
- Main screens: `packages/mobile/app/index.tsx`, `packages/mobile/app/login.tsx`, `packages/mobile/app/(app)/sessions/index.tsx`, `packages/mobile/app/(app)/repos/index.tsx`, `packages/mobile/app/(app)/settings/index.tsx`, `packages/mobile/app/(app)/routines/index.tsx`, `packages/mobile/app/(app)/routines/[routineId].tsx`, `packages/mobile/app/(app)/terminal/index.tsx`
- Session detail: `packages/mobile/app/(app)/sessions/[sessionId].tsx`, `packages/mobile/components/MessageBubble.tsx`, `packages/mobile/components/ToolCallView.tsx`, `packages/mobile/components/PermissionCard.tsx`, `packages/mobile/components/session/SessionComposer.tsx`, `packages/mobile/components/session/ComposerToolbar.tsx`, `packages/mobile/components/session/CommandPaletteSheet.tsx`, `packages/mobile/components/session/SessionSummaryCard.tsx`

## Implementazione consigliata

### 1. Design foundation e tokens

- Estendere `packages/mobile/lib/theme.ts` con token semantici riusabili: `surfaceMuted`, `surfaceRaised`, `critical`, `warning`, `success`, `focusRing`, `shadowSoft`, `shadowStrong`, `codeAccent`, evitando colori hardcoded sparsi.
- Aggiornare `SurfaceCard`, `ActionButton`, `TextField`, `InfoChip`, `EmptyState`, `ErrorBanner` per usare i token e rendere coerenti radius, border, focus, disabled, loading e pressed states.
- Rendere il dark mode meno monocromatico per stati semantici: success/warn/danger devono restare distinguibili anche in dark.
- Centralizzare pattern di motion in `packages/mobile/lib/animation.ts`: press scale, stagger card entrance, skeleton pulse, expandable content.

### 2. App shell piu pulita e meno densa

- Snellire `AppHeader`: ridurre copy duplicata, dare gerarchia piu chiara a stato host/GitHub/workspace, aumentare tap target e aggiungere `accessibilityLabel`/`accessibilityHint` ai pulsanti settings/profile/drawer.
- Rifinire `AppTabBar`: gestire meglio schermi stretti, ridurre larghezze fisse, mantenere badge/status ma con label piu corta e leggibile.
- Migliorare `DrawerMenu`: renderlo piu operativo e meno marketing, con sezioni rapide per Host, Workspace, GitHub, Execution e nav; aggiungere stati di refresh visibili e tap target coerenti.
- Tenere `settings` e `user` come destinazioni da header/drawer, non come tab bottom principali; assicurare che le route extra non producano slot vuoti nella tab bar custom.

### 3. Polish schermate principali

- `app/index.tsx`: rendere onboarding/connection piu guidato, con step visivi Pair -> Validate -> Login; migliorare trust/error copy e layout su schermi piccoli.
- `app/login.tsx`: mantenere animazioni ma ridurre shadow legacy/hardcoded; migliorare form validation visuale, remember-me, successo/errore e stati loading.
- `sessions/index.tsx`: rendere hero meno verboso, mettere search e CTA in layout responsive, aggiungere skeleton coerente con card reali e stato empty piu utile.
- `repos/index.tsx`: separare chiaramente local projects, GitHub repos e branch/session setup; usare cards compatte per repo list e stati disabled piu espliciti quando container/GitHub non sono pronti.
- `settings/index.tsx`: spezzare la densita visuale in sezioni piu scansionabili, mantenendo il file esistente; aggiungere sticky/quick section chips, warning panels coerenti e controls piu uniformi.
- `routines/*`: migliorare il detail form con preview del trigger, token API copiabile/leggibile, cron presets piu chiari, empty/loading states non generici.
- `terminal/index.tsx`: rimuovere l'uso di `SafeAreaView` da React Native, rifinire empty state, tab strip, toolbar e stato di connessione WebView mantenendo il terminale esistente.

### 4. Session detail, transcript e composer

- `sessions/[sessionId].tsx`: alleggerire il top chrome, rendere title/location/status leggibili, rendere GitHub/file/actions piu espliciti con labels/accessibility.
- `MessageBubble.tsx`: migliorare spacing tra testo, reasoning, tool calls e patch; aggiungere progressive disclosure piu chiara per reasoning/tool output; rendere code block piu leggibile su mobile.
- `ToolCallView.tsx`: rendere status/timing/input/output piu compatti, aggiungere copy affordance per output lunghi e limitare rumore visivo dei dettagli chiusi.
- `PermissionCard.tsx`: aumentare chiarezza del rischio con gerarchia Reject / Allow once / Always allow, colori semantici reali in dark mode, e descrizioni piu scansionabili.
- `SessionComposer.tsx` e `ComposerToolbar.tsx`: rendere input/comandi/attachment/model/MCP piu chiari; migliorare slash suggestions con categorie e stato loading/empty; aggiungere accessibility labels a tutti i pulsanti icon-only.

### 5. Stati, accessibilita e responsiveness

- Aggiungere pattern coerenti per loading, empty, offline, auth missing, GitHub missing, container unavailable, cleaned worktree e session busy.
- Aggiungere `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` e `accessibilityState` su Pressable icon-only e azioni critiche.
- Usare `useWindowDimensions` dove servono breakpoint, evitare larghezze fisse fragili e ridurre layout orizzontali su width < 390.
- Aggiungere `selectable` solo su dati importanti/copiabili, evitando testo decorativo selezionabile ovunque se peggiora l'esperienza.

## Ordine di lavoro

1. Aggiornare foundation UI (`theme.ts`, `animation.ts`, `components/ui/*`, `Skeleton.tsx`).
2. Rifinire shell (`AppHeader`, `AppTabBar`, `DrawerMenu`) e verificare navigazione base.
3. Rifinire screens top-level (`index`, `login`, `sessions`, `repos`, `settings`, `routines`, `terminal`).
4. Rifinire session detail/transcript/composer e componenti correlati.
5. Fare pass finale di accessibility/responsiveness su tutte le schermate toccate.

## Rischi

- `settings/index.tsx` e `sessions/[sessionId].tsx` sono file grandi: fare modifiche incrementali per evitare regressioni.
- L'app usa NativeWind e inline styles misti: non tentare una migrazione totale in questo pass.
- `AdaptiveBlur` e' un fallback View, non blur nativo: evitare di promettere effetti glass che non esistono davvero senza nuova dipendenza.
- Terminale WebView e session streaming sono sensibili: mantenere logica invariata e limitarsi al chrome/UI.

## Verifica

- Da `packages/mobile`: `bun run typecheck`.
- Avvio: `bun run start` o `npx expo start`; provare prima Expo Go se possibile.
- Smoke test manuale: connect -> login/register -> sessions list -> create session -> send prompt -> permission card -> command palette -> repos -> settings -> routines -> terminal.
- Test responsive: iPhone SE/schermo stretto, iPhone Pro, Android medio; controllare keyboard composer, tab bar, drawer, long content e dark/light mode.
- Accessibilita: VoiceOver/TalkBack su pulsanti icon-only, azioni destructive, inputs, tab bar e permission card.
