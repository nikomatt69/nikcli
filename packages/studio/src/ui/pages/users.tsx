import { createSignal, createResource, For, Show } from "solid-js"
import { userApi, type UserProfile } from "~/api"
import { Loading } from "~/components/loading"

const USER_TOKEN_KEY = "nikcli_user_token"

function getStoredToken() {
  return typeof localStorage !== "undefined" ? localStorage.getItem(USER_TOKEN_KEY) : null
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
      setRegUsername(""); setRegEmail(""); setRegPassword(""); setRegDisplay("")
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
          <button class="btn" onClick={handleLogout}>Sign out</button>
        </Show>
      </div>

      {/* Not logged in */}
      <Show when={!token()}>
        <Show when={status()?.hasUsers === false}>
          {/* No users exist — show registration */}
          <p class="page-desc">No users yet. Create the first account (will be admin).</p>
          <form onSubmit={handleRegister} class="add-form" style="max-width:400px">
            <input class="input" placeholder="Username" value={regUsername()} onInput={(e) => setRegUsername(e.currentTarget.value)} required />
            <input class="input" placeholder="Display name (optional)" value={regDisplay()} onInput={(e) => setRegDisplay(e.currentTarget.value)} />
            <input class="input" placeholder="Email" type="email" value={regEmail()} onInput={(e) => setRegEmail(e.currentTarget.value)} required />
            <input class="input" placeholder="Password (min 8 chars)" type="password" value={regPassword()} onInput={(e) => setRegPassword(e.currentTarget.value)} required minLength={8} />
            <Show when={regError()}>
              <div class="page-error">{regError()}</div>
            </Show>
            <button class="btn btn-primary" type="submit" disabled={regBusy()}>
              {regBusy() ? "Creating..." : "Create account"}
            </button>
          </form>
        </Show>

        <Show when={status()?.hasUsers !== false}>
          {/* Users exist — show login */}
          <p class="page-desc">Sign in to manage users.</p>
          <form onSubmit={handleLogin} class="add-form" style="max-width:400px">
            <input class="input" placeholder="Email" type="email" value={loginEmail()} onInput={(e) => setLoginEmail(e.currentTarget.value)} required />
            <input class="input" placeholder="Password" type="password" value={loginPassword()} onInput={(e) => setLoginPassword(e.currentTarget.value)} required />
            <Show when={loginError()}>
              <div class="page-error">{loginError()}</div>
            </Show>
            <button class="btn btn-primary" type="submit" disabled={loginBusy()}>
              {loginBusy() ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </Show>

        <Show when={status.loading}>
          <Loading />
        </Show>
      </Show>

      {/* Logged in */}
      <Show when={token() && currentUser()}>
        <div class="current-user-info" style="margin-bottom:16px;padding:12px;background:var(--surface-2,#1e1e1e);border-radius:8px;border:1px solid var(--border,#333)">
          <span style="font-weight:600;color:var(--text)">{currentUser()?.display_name || currentUser()?.username}</span>
          <span style="margin-left:8px;font-size:12px;color:var(--text-muted)">{currentUser()?.email}</span>
          <span style="margin-left:8px;font-size:11px;padding:2px 6px;border-radius:4px;background:var(--accent-bg,#2a2a2a);color:var(--accent,#7c7cff)">
            {currentUser()?.role}
          </span>
        </div>

        <Show when={currentUser()?.role === "admin"}>
          <div class="page-header" style="margin-bottom:12px">
            <span style="font-size:14px;font-weight:600;color:var(--text)">
              All users ({users()?.length ?? 0})
            </span>
            <button class="btn btn-primary" onClick={() => setShowCreate(!showCreate())}>
              {showCreate() ? "Cancel" : "+ Add user"}
            </button>
          </div>

          <Show when={showCreate()}>
            <form onSubmit={handleCreateUser} class="add-form" style="max-width:400px;margin-bottom:16px">
              <input class="input" placeholder="Username" value={regUsername()} onInput={(e) => setRegUsername(e.currentTarget.value)} required />
              <input class="input" placeholder="Display name (optional)" value={regDisplay()} onInput={(e) => setRegDisplay(e.currentTarget.value)} />
              <input class="input" placeholder="Email" type="email" value={regEmail()} onInput={(e) => setRegEmail(e.currentTarget.value)} required />
              <input class="input" placeholder="Password (min 8 chars)" type="password" value={regPassword()} onInput={(e) => setRegPassword(e.currentTarget.value)} required minLength={8} />
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

          <div class="list">
            <For each={users()}>
              {(u) => (
                <div class="list-item" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                  <div style="min-width:0;flex:1">
                    <div style="font-weight:600;font-size:13px;color:var(--text)">
                      {u.display_name || u.username}
                      {u.id === currentUser()?.id ? <span style="margin-left:6px;font-size:11px;color:var(--text-muted)">(you)</span> : null}
                    </div>
                    <div style="font-size:12px;color:var(--text-muted)">{u.email} · @{u.username}</div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                    <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:var(--surface-2,#1e1e1e);color:var(--text-muted)">
                      {u.role}
                    </span>
                    <Show when={u.id !== currentUser()?.id}>
                      <button class="btn" onClick={() => handleRoleToggle(u)} style="font-size:12px;padding:4px 8px">
                        {u.role === "admin" ? "Demote" : "Promote"}
                      </button>
                      <button class="btn" onClick={() => handleDelete(u.id)} style="font-size:12px;padding:4px 8px;color:var(--error,#f44)">
                        Delete
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
            <Show when={!users.loading && (users()?.length ?? 0) === 0}>
              <div style="color:var(--text-muted);font-size:13px;padding:12px">No other users.</div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}
