import HomeTips from "../feature-plugins/home/tips"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import PluginManager from "../feature-plugins/system/plugins"
import Fusion from "../feature-plugins/system/fusion"
import Loops from "../feature-plugins/loops"
import Missions from "../feature-plugins/mission"
import Brain from "../feature-plugins/brain"
import Browser from "../feature-plugins/browser"
import Chatbot from "../feature-plugins/chatbot"
import Computer from "../feature-plugins/computer"
import Connectors from "../feature-plugins/connectors"
import Observability from "../feature-plugins/observability"

import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"

export type InternalTuiPlugin = TuiPluginModule & {
  id: string
  tui: TuiPlugin
}

export const INTERNAL_TUI_PLUGINS: InternalTuiPlugin[] = [
  HomeTips,
  SidebarContext,
  SidebarMcp,
  SidebarLsp,
  SidebarTodo,
  SidebarFiles,
  SidebarFooter,
  PluginManager,
  Fusion,
  Missions,
  Loops,
  Brain,
  Browser,
  Chatbot,
  Computer,
  Connectors,
  Observability,
]
