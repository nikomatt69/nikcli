import type { Page } from "@playwright/test"

export async function login(page: Page) {
  await page.goto("/")
  // TODO: Implement login flow
}

export async function createSession(page: Page, name: string) {
  await page.goto("/session")
  await page.click("text=New Session")
  await page.fill("input", name)
  await page.click("text=Create")
}
