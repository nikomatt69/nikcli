import type { DatabaseMigration } from "./migration"
import initial from "./migration/20260610211500_initial"

export const migrations = [initial] satisfies DatabaseMigration.Migration[]
