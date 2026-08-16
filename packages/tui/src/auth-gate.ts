export async function requireAuthenticated<T>(authenticate: () => Promise<T | null>): Promise<T> {
  while (true) {
    const user = await authenticate()
    if (user) return user
  }
}
