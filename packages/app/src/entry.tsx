import { render } from "solid-js/web"
import { Router } from "@solidjs/router"
import App from "./app"
import "./index.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

render(
  () => (
    <Router>
      <App />
    </Router>
  ),
  root,
)
