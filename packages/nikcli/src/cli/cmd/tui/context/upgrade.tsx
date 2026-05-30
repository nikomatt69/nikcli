import { createSimpleContext } from "./helper"

export const { use: useUpgrade, provider: UpgradeProvider } = createSimpleContext({
  name: "Upgrade",
  init: (input: {
    upgradeNow?: (method: string, version: string) => Promise<void>
  }) => ({
    upgradeNow: input.upgradeNow,
  }),
})
