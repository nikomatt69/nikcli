import type { DatabaseMigration } from "./migration"
import initial from "./migration/20260610211500_initial"
import sessionMessageTodoPermission from "./migration/20260611000000_session_message_todo_permission"
import syncEventSequence from "./migration/20260611010000_sync_event_sequence"
import importLegacyDatabases from "./migration/20260611020000_import_legacy_databases"
import importJsonStorage from "./migration/20260611030000_import_json_storage"
import importSyncJson from "./migration/20260611040000_import_sync_json"

export const migrations = [
  initial,
  sessionMessageTodoPermission,
  syncEventSequence,
  importLegacyDatabases,
  importJsonStorage,
  importSyncJson,
] satisfies DatabaseMigration.Migration[]
