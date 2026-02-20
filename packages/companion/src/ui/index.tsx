import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./App"

const styles = `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0d1117;
  color: #c9d1d9;
  min-height: 100vh;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
}

.chat-empty h2 {
  font-size: 24px;
  font-weight: 600;
  color: #c9d1d9;
  margin-bottom: 8px;
}

.chat-empty p {
  font-size: 14px;
  color: #8b949e;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-height: 0;
}

.message {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 8px;
}

.message.assistant {
  background: #161b22;
}

.message.tool {
  background: #1c2128;
  border-left: 3px solid #58a6ff;
}

.message.result {
  background: #0d1117;
  border-left: 3px solid #238636;
  font-size: 13px;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.tool-icon {
  font-size: 14px;
}

.tool-name {
  font-weight: 600;
  color: #58a6ff;
}

.tool-input pre {
  font-size: 12px;
  color: #8b949e;
  overflow-x: auto;
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.5;
}

.composer {
  display: flex;
  gap: 8px;
  padding: 16px;
  background: #161b22;
  border-top: 1px solid #30363d;
}

.composer input {
  flex: 1;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
}

.composer input:focus {
  outline: none;
  border-color: #58a6ff;
}

.composer button {
  background: #238636;
  color: #fff;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.composer button:hover:not(:disabled) {
  background: #2ea043;
}

.composer button:disabled {
  background: #30363d;
  cursor: not-allowed;
}

.permission-banner {
  background: #1c2128;
  border-bottom: 1px solid #da3633;
  padding: 16px;
}

.permission-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #f85149;
  margin-bottom: 12px;
}

.permission-details {
  background: #0d1117;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.permission-details pre {
  font-size: 12px;
  color: #8b949e;
}

.permission-actions {
  display: flex;
  gap: 8px;
}

.btn-allow {
  background: #238636;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.btn-deny {
  background: #da3633;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
}

.loading a {
  color: #58a6ff;
}

.bottom-navbar {
  background: #161b22;
  border-top: 1px solid #30363d;
  position: relative;
  z-index: 100;
  max-height: 50vh;
  display: flex;
  flex-direction: column;
  transition: max-height 0.3s ease;
}

.bottom-navbar.expanded {
  max-height: 50vh;
}

.bottom-navbar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #30363d;
}

.bottom-navbar-header:hover {
  background: #1c2128;
}

.navbar-title {
  font-weight: 600;
  color: #c9d1d9;
  font-size: 14px;
}

.navbar-count {
  background: #30363d;
  color: #8b949e;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.navbar-toggle {
  margin-left: auto;
  color: #8b949e;
  font-size: 12px;
}

.bottom-navbar-content {
  overflow-y: auto;
  max-height: calc(50vh - 50px);
}

.sessions-list {
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 4px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  color: #c9d1d9;
  font-size: 13px;
  transition: all 0.2s;
}

.session-item:hover {
  background: #161b22;
  border-color: #58a6ff;
}

.session-item.active {
  background: #1c2128;
  border-color: #58a6ff;
  color: #58a6ff;
}

.session-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.session-status[data-status="running"] {
  background: #238636;
}

.session-status[data-status="waiting"],
.session-status[data-status="starting"] {
  background: #f0883e;
}

.session-status[data-status="stopped"],
.session-status[data-status="paused"] {
  background: #8b949e;
}

.session-status[data-status="error"] {
  background: #da3633;
}

.session-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sessions-empty {
  padding: 20px;
  text-align: center;
  color: #8b949e;
  font-size: 13px;
}

@media (min-width: 768px) {
  .bottom-navbar {
    max-height: 40vh;
  }
  
  .bottom-navbar.expanded {
    max-height: 40vh;
  }
  
  .sessions-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }
  
  .session-item {
    min-width: 0;
  }
}
`

const styleEl = document.createElement("style")
styleEl.textContent = styles
document.head.appendChild(styleEl)

const root = ReactDOM.createRoot(document.getElementById("root")!)
root.render(<App />)
