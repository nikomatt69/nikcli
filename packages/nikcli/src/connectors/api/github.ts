import { ConnectorAuth } from "../auth"

const GITHUB_API_BASE = "https://api.github.com"

export namespace GithubApi {
  export async function getRepo(token: string, owner: string, repo: string): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getRepoContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<any> {
    const url = ref
      ? `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
      : `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function createIssue(
    token: string,
    owner: string,
    repo: string,
    title: string,
    body?: string,
  ): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body }),
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GitHub API error: ${response.status} - ${error}`)
    }
    return response.json()
  }

  export async function getIssue(token: string, owner: string, repo: string, issueNumber: number): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function listIssues(
    token: string,
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "open",
  ): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function searchCode(token: string, query: string, sort?: string, order?: "asc" | "desc"): Promise<any> {
    let url = `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(query)}`
    if (sort) url += `&sort=${sort}&order=${order}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function searchRepos(
    token: string,
    query: string,
    sort?: "stars" | "updated" | "help-wanted-issues",
  ): Promise<any> {
    let url = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(query)}`
    if (sort) url += `&sort=${sort}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getUser(token: string): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function listRepos(
    token: string,
    type: "all" | "owner" | "member" = "owner",
    sort?: "updated" | "pushed" | "full_name",
  ): Promise<any> {
    let url = `${GITHUB_API_BASE}/user/repos?type=${type}`
    if (sort) url += `&sort=${sort}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function listBranches(token: string, owner: string, repo: string): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/branches?per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function findPullRequestByHead(
    token: string,
    owner: string,
    repo: string,
    head: string,
    state: "open" | "closed" | "all" = "open",
  ): Promise<any | undefined> {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(head)}&state=${state}&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    )
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    const pulls = (await response.json()) as any[]
    return pulls[0]
  }

  export async function createPullRequest(
    token: string,
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string,
  ): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, head, base, body }),
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GitHub API error: ${response.status} - ${error}`)
    }
    return response.json()
  }

  export async function getPullRequest(token: string, owner: string, repo: string, pullNumber: number): Promise<any> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getFileContent(token: string, owner: string, repo: string, path: string): Promise<string> {
    const content = await getRepoContent(token, owner, repo, path)
    if (content.encoding === "base64" && content.content) {
      return Buffer.from(content.content, "base64").toString("utf-8")
    }
    throw new Error("Unable to decode file content")
  }
}

export async function getToken(name: string): Promise<string | null> {
  const auth = await ConnectorAuth.get(name)
  return auth?.token ?? null
}
