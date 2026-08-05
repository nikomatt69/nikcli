import type { DatabaseMigration } from "./migration"
import initial from "./migration/20260610211500_initial"
import sessionMessageTodoPermission from "./migration/20260611000000_session_message_todo_permission"
import syncEventSequence from "./migration/20260611010000_sync_event_sequence"
import importLegacyDatabases from "./migration/20260611020000_import_legacy_databases"
import importJsonStorage from "./migration/20260611030000_import_json_storage"
import importSyncJson from "./migration/20260611040000_import_sync_json"
import sessionV2Event from "./migration/20260612000000_session_v2_event"
import syncUnify from "./migration/20260630000000_sync_unify"
import workspaceDropEvents from "./migration/20260630000100_workspace_drop_events"
import userExternalSubject from "./migration/20260716000000_user_external_subject"
import sessionEntry from "./migration/20260805000000_session_entry"

export const migrations = [
  initial,
  sessionMessageTodoPermission,
  syncEventSequence,
  importLegacyDatabases,
  importJsonStorage,
  importSyncJson,
  sessionV2Event,
  syncUnify,
  workspaceDropEvents,
  userExternalSubject,
  sessionEntry,
] satisfies DatabaseMigration.Migration[]
