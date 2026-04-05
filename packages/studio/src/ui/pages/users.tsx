import { createSignal, createResource, For, Show } from "solid-js"
import { userApi, type UserProfile } from "~/api"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"

function getStoredToken() {
  return userApi.getToken()
}

export function UsersPage() {
  const [token, setToken] = createSignal(getStoredToken())
  const [loginEmail, setLoginEmail] = createSignal("")
  const [loginPassword, setLoginPassword] = createSignal("")
  const [loginError, setLoginError] = createSignal<string | null>(null)
  const [loginBusy, setLoginBusy] = createSignal(false)
  const [regUsername, setRegUsername] = createSignal("")
  const [regEmail, setRegEmail] = createSignal("")
  const [regPassword, setRegPassword] = createSignal("")
  const [regDisplay, setRegDisplay] = createSignal("")
  const [regError, setRegError] = createSignal<string | null>(null)
  const [regBusy, setRegBusy] = createSignal(false)
  const [showCreate, setShowCreate] = createSignal(false)

  const [status] = createResource(userApi.status)
  const [currentUser, { refetch: refetchMe }] = createResource(
    () => !!token(),
    async () => {
      if (!token()) return null
      return userApi.me().catch(() => null)
    },
  )
  const [users, { refetch: refetchUsers }] = createResource(
    () => currentUser()?.role === "admin",
    async () => {
      if (currentUser()?.role !== "admin") return []
      return userApi.list().catch(() => [] as UserProfile[])
    },
  )

  const handleLogin = async (e: Event) => {
    e.preventDefault()
    setLoginBusy(true)
    setLoginError(null)
    try {
      const { token: t } = await userApi.login(loginEmail(), loginPassword())
      userApi.saveToken(t)
      setToken(t)
      refetchMe()
    } catch (err: any) {
      setLoginError(err.message || "Invalid credentials")
    } finally {
      setLoginBusy(false)
    }
  }

  const handleRegister = async (e: Event) => {
    e.preventDefault()
    setRegBusy(true)
    setRegError(null)
    try {
      const { token: t } = await userApi.register({
        username: regUsername(),
        email: regEmail(),
        password: regPassword(),
        displayName: regDisplay() || undefined,
      })
      userApi.saveToken(t)
      setToken(t)
      refetchMe()
    } catch (err: any) {
      setRegError(err.message || "Registration failed")
    } finally {
      setRegBusy(false)
    }
  }

  const handleLogout = async () => {
    await userApi.logout().catch(() => undefined)
    userApi.clearToken()
    setToken(null)
    refetchMe()
  }

  const handleDelete = async (id: string) => {
    await userApi.delete(id).catch(() => undefined)
    refetchUsers()
  }

  const handleRoleToggle = async (u: UserProfile) => {
    await userApi.update(u.id, { role: u.role === "admin" ? "user" : "admin" }).catch(() => undefined)
    refetchUsers()
  }

  const handleCreateUser = async (e: Event) => {
    e.preventDefault()
    setRegBusy(true)
    setRegError(null)
    try {
      await userApi.register({
        username: regUsername(),
        email: regEmail(),
        password: regPassword(),
        displayName: regDisplay() || undefined,
      })
      setRegUsername("")
      setRegEmail("")
      setRegPassword("")
      setRegDisplay("")
      setShowCreate(false)
      refetchUsers()
    } catch (err: any) {
      setRegError(err.message || "Failed to create user")
    } finally {
      setRegBusy(false)
    }
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>Users</h1>
        <Show when={currentUser()}>
          <button class="btn btn-secondary" onClick={handleLogout}>
            Sign out
          </button>
        </Show>
      </div>

      {/* Not logged in */}
      <Show when={!token()}>
        <Show when={status.loading}>
          <Loading />
        </Show>
        <Show when={!status.loading}>
          <Show when={status()?.hasUsers === false}>
            <div class="auth-container">
              <div class="auth-logo">
                <div class="auth-icon">N</div>
                <h2>nikcli Studio</h2>
                <p>Create your admin account to get started.</p>
              </div>
              <form onSubmit={handleRegister} class="auth-form">
                <div class="form-field">
                  <label>Username</label>
                  <input
                    class="input"
                    placeholder="Username"
                    value={regUsername()}
                    onInput={(e) => setRegUsername(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-field">
                  <label>Display name (optional)</label>
                  <input
                    class="input"
                    placeholder="Display name"
                    value={regDisplay()}
                    onInput={(e) => setRegDisplay(e.currentTarget.value)}
                  />
                </div>
                <div class="form-field">
                  <label>Email</label>
                  <input
                    class="input"
                    placeholder="email@example.com"
                    type="email"
                    value={regEmail()}
                    onInput={(e) => setRegEmail(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-field">
                  <label>Password</label>
                  <input
                    class="input"
                    placeholder="Min 8 characters"
                    type="password"
                    value={regPassword()}
                    onInput={(e) => setRegPassword(e.currentTarget.value)}
                    required
                    minLength={8}
                  />
                </div>
                <Show when={regError()}>
                  <div class="page-error">{regError()}</div>
                </Show>
                <button class="btn btn-primary" type="submit" disabled={regBusy()} style="width:100%;margin-top:4px">
                  {regBusy() ? "Creating..." : "Create account"}
                </button>
              </form>
            </div>
          </Show>
          <Show when={status()?.hasUsers !== false}>
            <div class="auth-container">
              <div class="auth-logo">
                <div class="auth-icon">N</div>
                <h2>Sign in</h2>
                <p>Access nikcli Studio.</p>
              </div>
              <form onSubmit={handleLogin} class="auth-form">
                <div class="form-field">
                  <label>Email</label>
                  <input
                    class="input"
                    placeholder="email@example.com"
                    type="email"
                    value={loginEmail()}
                    onInput={(e) => setLoginEmail(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-field">
                  <label>Password</label>
                  <input
                    class="input"
                    placeholder="Your password"
                    type="password"
                    value={loginPassword()}
                    onInput={(e) => setLoginPassword(e.currentTarget.value)}
                    required
                  />
                </div>
                <Show when={loginError()}>
                  <div class="page-error">{loginError()}</div>
                </Show>
                <button class="btn btn-primary" type="submit" disabled={loginBusy()} style="width:100%;margin-top:4px">
                  {loginBusy() ? "Signing in..." : "Sign in"}
                </button>
              </form>
            </div>
          </Show>
        </Show>
      </Show>

      {/* Logged in */}
      <Show when={token() && currentUser()}>
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <div class="card-title">
              {currentUser()?.display_name || currentUser()?.username}
              <span class="tag">{currentUser()?.email}</span>
            </div>
            <div class="card-actions">
              <span class={`tag ${currentUser()?.role === "admin" ? "tag-active" : ""}`}>{currentUser()?.role}</span>
            </div>
          </div>
        </div>

        <Show when={currentUser()?.role === "admin"}>
          <div class="page-header" style="margin-bottom:12px">
            <span style="font-size:14px;font-weight:600">All users ({users()?.length ?? 0})</span>
            <button class="btn btn-primary" onClick={() => setShowCreate(!showCreate())}>
              {showCreate() ? "Cancel" : "+ Add user"}
            </button>
          </div>

          <Show when={showCreate()}>
            <form onSubmit={handleCreateUser} class="add-form" style="max-width:400px;margin-bottom:16px">
              <input
                class="input"
                placeholder="Username"
                value={regUsername()}
                onInput={(e) => setRegUsername(e.currentTarget.value)}
                required
              />
              <input
                class="input"
                placeholder="Display name (optional)"
                value={regDisplay()}
                onInput={(e) => setRegDisplay(e.currentTarget.value)}
              />
              <input
                class="input"
                placeholder="Email"
                type="email"
                value={regEmail()}
                onInput={(e) => setRegEmail(e.currentTarget.value)}
                required
              />
              <input
                class="input"
                placeholder="Password (min 8 chars)"
                type="password"
                value={regPassword()}
                onInput={(e) => setRegPassword(e.currentTarget.value)}
                required
                minLength={8}
              />
              <Show when={regError()}>
                <div class="page-error">{regError()}</div>
              </Show>
              <button class="btn btn-primary" type="submit" disabled={regBusy()}>
                {regBusy() ? "Creating..." : "Create user"}
              </button>
            </form>
          </Show>

          <Show when={users.loading}>
            <Loading />
          </Show>

          <div class="card-list">
            <For each={users()}>
              {(u) => (
                <div class="card">
                  <div class="card-header">
                    <div class="card-title">
                      {u.display_name || u.username}
                      {u.id === currentUser()?.id ? <span class="text-muted text-xs">(you)</span> : null}
                    </div>
                    <div class="card-actions">
                      <span class="tag">{u.role}</span>
                      <Show when={u.id !== currentUser()?.id}>
                        <button class="btn btn-secondary btn-sm" onClick={() => handleRoleToggle(u)}>
                          {u.role === "admin" ? "Demote" : "Promote"}
                        </button>
                        <button class="btn btn-danger btn-sm" onClick={() => handleDelete(u.id)}>
                          Delete
                        </button>
                      </Show>
                    </div>
                  </div>
                  <div class="card-meta">
                    <span>{u.email}</span>
                    <code class="code-inline">@{u.username}</code>
                  </div>
                </div>
              )}
            </For>
            <Show when={!users.loading && (users()?.length ?? 0) === 0}>
              <EmptyState title="No other users." />
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}
