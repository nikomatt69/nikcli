import { MobileAuth } from "@/mobile/auth"

export function tokenList() {
  return MobileAuth.list()
}

export function tokenCreate(input: { name?: string; expiresInDays?: number } | void) {
  return MobileAuth.create(input ?? {})
}

export async function tokenRevoke(id: string) {
  return { revoked: await MobileAuth.remove(id) }
}
