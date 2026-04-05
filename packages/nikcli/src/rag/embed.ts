import { ModelsDev } from "@/provider/models"
import { Auth } from "@/auth"
import { Env } from "@/env"
import { Log } from "@/util/log"
import { Config } from "@/config/config"

const BATCH_SIZE = 32

type EmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>
}

type OllamaEmbeddingResponse = {
  embedding: number[]
}

export namespace RagEmbed {
  const log = Log.create({ service: "rag.embed" })

  function normalizeBaseURL(baseURL: string): string {
    return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL
  }

  function normalizeOllamaV1BaseURL(baseURL: string): string {
    const url = normalizeBaseURL(baseURL)
    if (url.endsWith("/v1")) return url
    return `${url}/v1`
  }

  function ollamaRootFromV1BaseURL(baseURL: string): string {
    const url = normalizeBaseURL(baseURL)
    if (url.endsWith("/v1")) return url.slice(0, -3)
    return url
  }

  async function resolveOllama() {
    const config = await Config.get().catch(() => undefined)
    const baseURL = normalizeOllamaV1BaseURL(
      (config as any)?.provider?.ollama?.options?.baseURL ?? Env.get("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434/v1",
    )

    const auth = await Auth.get("ollama").catch(() => undefined)
    const apiKey =
      (config as any)?.provider?.ollama?.options?.apiKey ??
      (auth && (auth as any).type === "api" ? (auth as any).key : undefined) ??
      Env.get("OLLAMA_API_KEY") ??
      "ollama"

    return { baseURL, root: ollamaRootFromV1BaseURL(baseURL), apiKey }
  }

  export async function embedAll(texts: string[], model?: string, provider?: string) {
    if (texts.length === 0) return [] as number[][]
    const config = await Config.get().catch(() => undefined)
    const chosen = model ?? config?.rag?.model
    const chosenProvider = provider ?? config?.rag?.provider
    if (!chosen || !chosenProvider) {
      throw new Error(
        `RAG model or provider not configured. Run 'nikcli rag-model <provider> <model>' to set embedding model.`,
      )
    }
    const batches = Array.from({ length: Math.ceil(texts.length / BATCH_SIZE) }, (_, index) => {
      const start = index * BATCH_SIZE
      const end = start + BATCH_SIZE
      return texts.slice(start, end)
    })

    const results: number[][] = []
    for (const batch of batches) {
      const embedded = await embedBatch(batch, chosen, chosenProvider)
      results.push(...embedded)
    }
    return results
  }

  async function embedBatch(texts: string[], model: string, provider: string) {
    if (provider === "ollama") {
      return embedOllama(texts, model)
    }

    const { api, key } = await resolveProvider(provider)
    const response = await fetch(`${api}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, input: texts }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Embedding request failed (${response.status}): ${body}`)
    }

    const json = (await response.json()) as EmbeddingResponse
    if (!Array.isArray(json.data)) {
      throw new Error(`Unexpected embedding response shape: ${JSON.stringify(json)}`)
    }
    const sorted = json.data.sort((a, b) => a.index - b.index)
    return sorted.map((item) => item.embedding)
  }

  async function embedOllama(texts: string[], model: string) {
    const { baseURL, root, apiKey } = await resolveOllama()

    // Prefer OpenAI-compatible embeddings when available (matches OpenCode docs).
    const openAiResponse = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts }),
    }).catch(() => undefined)

    if (openAiResponse?.ok) {
      const json = (await openAiResponse.json()) as EmbeddingResponse
      if (Array.isArray(json.data)) {
        const sorted = json.data.sort((a, b) => a.index - b.index)
        return sorted.map((item) => item.embedding)
      }
    }

    // Fallback to legacy Ollama embeddings endpoint.
    const results: number[][] = []
    for (const text of texts) {
      const truncated = text.slice(0, 500)
      const response = await fetch(`${root}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: truncated }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Error(`Ollama embedding failed (${response.status}): ${body}`)
      }

      const json = (await response.json()) as OllamaEmbeddingResponse
      results.push(json.embedding)
    }
    return results
  }

  const KNOWN_PROVIDER_APIS: Record<string, string> = {
    openrouter: "https://openrouter.ai/api/v1",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    google: "https://generativelanguage.googleapis.com/v1beta/openai",
    mistral: "https://api.mistral.ai/v1",
    together: "https://api.together.xyz/v1",
    groq: "https://api.groq.com/openai/v1",
    cohere: "https://api.cohere.ai/v1",
    nvidia: "https://integrate.api.nvidia.com/v1",
    voyage: "https://api.voyageai.com/v1",
  }

  async function resolveProvider(providerID: string) {
    const auth = await Auth.get(providerID)
    const key = auth?.type === "api" ? auth.key : Env.get(`${providerID.toUpperCase()}_API_KEY`)
    if (!key) {
      throw new Error(`Missing ${providerID} API key. Run \`nikcli auth login\` for provider ${providerID}.`)
    }

    const database = await ModelsDev.get()
    const provider = database[providerID]
    const api = provider?.api ?? KNOWN_PROVIDER_APIS[providerID]
    if (!api) {
      log.error("provider missing api", { provider: providerID })
      throw new Error(`${providerID} provider configuration not found. Set rag.provider to a supported provider.`)
    }

    return { api, key }
  }
}
