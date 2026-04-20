import { PermissionNext } from "./next"
import * as PermissionSchema from "./schema"

export const Action = PermissionSchema.Action
export type Action = PermissionSchema.Action

export const Rule = PermissionSchema.Rule
export type Rule = PermissionSchema.Rule

export const Ruleset = PermissionSchema.Ruleset
export type Ruleset = PermissionSchema.Ruleset

export const fromConfig = PermissionNext.fromConfig
export const merge = PermissionNext.merge
export const evaluate = PermissionNext.evaluate
export const disabled = PermissionNext.disabled
export const disabledFromConfig = (permission: string, ruleset: Rule[] | PermissionNext.Ruleset, ...extra: Rule[]) => {
  return PermissionNext.disabled([permission], PermissionNext.merge(ruleset as PermissionNext.Ruleset, extra))
}
