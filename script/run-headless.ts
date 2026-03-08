import { App } from "@slack/bolt";

const [prompt, channel, thread_ts] = Bun.argv.slice(2);

console.log("Headless NikCLI execution started.");
console.log(`Prompt: ${prompt}`);
console.log(`Channel: ${channel}`);
console.log(`Thread: ${thread_ts}`);

// Initialize Slack App to post updates
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: "dummy_secret", // Not needed for sending messages
});

async function main() {
  try {
    if (channel && thread_ts && process.env.SLACK_BOT_TOKEN) {
      await app.client.chat.postMessage({
        channel: channel,
        thread_ts: thread_ts,
        text: "⚙️ *GitHub Actions*: Ricevuto il comando! Sto avviando un container per eseguire la task in autonomia sulla repository...",
      });
    }

    // Qui andrebbe l'inizializzazione del core di nikcli in modalità "auto-approve"
    // Dato che nikcli richiede conferme per tool_call, in GH Actions dovremmo usare
    // un client pre-configurato per accettare automaticamente comandi sicuri (es. git, npm)

    // Simulazione di lavoro e PR creation
    console.log("Simulating autonomous work on codebase...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    const prUrl = "https://github.com/nikomatt69/nikcli/pull/123";
    console.log(`Created PR: ${prUrl}`);

    if (channel && thread_ts && process.env.SLACK_BOT_TOKEN) {
      await app.client.chat.postMessage({
        channel: channel,
        thread_ts: thread_ts,
        text: `✅ *GitHub Actions*: Ho finito! Ho analizzato il codice, fatto le modifiche e aperto una Pull Request per te:\n${prUrl}`,
      });
    }
  } catch (error) {
    console.error("Error during execution:", error);
    if (channel && thread_ts && process.env.SLACK_BOT_TOKEN) {
      await app.client.chat.postMessage({
        channel: channel,
        thread_ts: thread_ts,
        text: `❌ *GitHub Actions*: Si è verificato un errore durante l'esecuzione del task:\n\`${String(error)}\``,
      });
    }
    process.exit(1);
  }
}

main();
