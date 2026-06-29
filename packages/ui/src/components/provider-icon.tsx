import type { Component, JSX } from "solid-js"
import { createMemo, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { iconNames, type IconName } from "./provider-icons/types"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

const providerIconAliases: Record<string, IconName> = {
  ollama: "ollama-cloud",
  "nikcli-inference": "nikcli",
}

export function resolveProviderIcon(id: string): IconName {
  const normalized = id.trim().toLowerCase()
  if (iconNames.includes(normalized as IconName)) return normalized as IconName

  const alias = providerIconAliases[normalized]
  if (alias) return alias

  const regionalPlan = normalized.match(/^(.+?)-(?:coding|token)-plan-(cn|ams|sgp)$/)
  if (regionalPlan) {
    const regional = `${regionalPlan[1]}-${regionalPlan[2]}`
    if (iconNames.includes(regional as IconName)) return regional as IconName
  }

  return (
    iconNames
      .filter((name) => normalized.startsWith(`${name}-`))
      .sort((a, b) => b.length - a.length)[0] ?? "synthetic"
  )
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const resolved = createMemo(() => resolveProviderIcon(local.id))
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${resolved()}`} />
    </svg>
  )
}
