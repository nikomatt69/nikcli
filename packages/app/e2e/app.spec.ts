import { test, expect } from "@playwright/test"

test("homepage has title and links", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle(/NikCLI/)
  await expect(page.locator("text=Welcome")).toBeVisible()
})

test("can navigate to session page", async ({ page }) => {
  await page.goto("/")
  await page.click("text=Start Session")
  await expect(page).toHaveURL(/.*session/)
})

test("can navigate to settings page", async ({ page }) => {
  await page.goto("/")
  await page.click("text=Settings")
  await expect(page).toHaveURL(/.*settings/)
})
