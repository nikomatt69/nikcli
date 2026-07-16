import { useEffect, useState } from "react"
import { completeOAuth } from "../auth/oauth"
import { saveSharedToken } from "../lib/studio-api"

export function OAuthCallback() {
  const [error, setError] = useState<string>()

  useEffect(() => {
    completeOAuth(window.location.href)
      .then((tokens) => {
        saveSharedToken(tokens.access)
        window.location.replace("/dashboard")
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Sign-in failed"))
  }, [])

  return (
    <p className={error ? "text-terminal-error" : "text-terminal-muted"}>{error || "Completing secure sign-in..."}</p>
  )
}
