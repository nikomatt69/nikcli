interface Env {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  // Optional override for the GitHub OAuth App "Authorization callback URL".
  // Defaults to `${ISSUER}/callback/github`. Pin this when the registered
  // callback differs from the default (e.g. a tenant-scoped subdomain).
  GITHUB_REDIRECT_URI?: string
}
