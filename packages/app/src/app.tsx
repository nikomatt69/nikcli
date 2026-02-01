import { Route } from "@solidjs/router"
import { ThemeProvider } from "./context/theme"
import { AppProvider } from "./context/app"
import { AuthProvider } from "./context/auth"
import { ApiProvider } from "./context/api"
import { LayoutProvider } from "./context/layout"
import { SessionProvider } from "./context/session"
import { PromptProvider } from "./context/prompt"
import { CommandProvider } from "./context/command"
import { SettingsProvider } from "./context/settings"
import { ServerProvider } from "./context/server"
import { I18nProvider } from "./i18n"

import Layout from "./components/layout/layout"
import Home from "./routes"
import Session from "./routes/session"
import Settings from "./routes/settings"
import NotFound from "./routes/not-found"

function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <AppProvider>
          <AuthProvider>
            <ApiProvider>
              <LayoutProvider>
                <SessionProvider>
                  <PromptProvider>
                    <CommandProvider>
                      <SettingsProvider>
                        <ServerProvider>
                          <Route path="/" component={Layout}>
                            <Route path="/" component={Home} />
                            <Route path="/session" component={Session} />
                            <Route path="/settings" component={Settings} />
                            <Route path="*" component={NotFound} />
                          </Route>
                        </ServerProvider>
                      </SettingsProvider>
                    </CommandProvider>
                  </PromptProvider>
                </SessionProvider>
              </LayoutProvider>
            </ApiProvider>
          </AuthProvider>
        </AppProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

export default App
