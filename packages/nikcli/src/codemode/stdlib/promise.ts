import type { PromiseMethodName } from "../interpreter/model"

export const promiseStatics = new Set<PromiseMethodName>(["all", "allSettled", "race", "any", "resolve", "reject"])
