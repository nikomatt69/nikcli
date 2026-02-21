import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./App"

const styles = `
:root {
  --bg-primary: #0a0a0b;
  --bg-secondary: #141416;
  --bg-tertiary: #1c1c1f;
  --bg-elevated: #232328;
  --border-subtle: #2a2a2f;
  --border-default: #38383f;
  --text-primary: #f4f4f5;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --accent-primary: #22d3ee;
  --accent-glow: rgba(34, 211, 238, 0.15);
  --accent-success: #10b981;
  --accent-warning: #f59e0b;
  --accent-danger: #ef4444;
  --font-display: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-full: 9999px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.6);
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-display);
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  min-height: 100dvh;
  overflow-x: hidden;
}

/* Background Pattern */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: 
    radial-gradient(ellipse 80% 50% at 50% -20%, var(--accent-glow), transparent),
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 50px,
      rgba(255,255,255,0.01) 50px,
      rgba(255,255,255,0.01) 51px
    ),
    repeating-linear-gradient(
      90deg,
      transparent,
      transparent 50px,
      rgba(255,255,255,0.01) 50px,
      rgba(255,255,255,0.01) 51px
    );
  pointer-events: none;
  z-index: -1;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, var(--accent-primary), #06b6d4);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  color: var(--bg-primary);
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
}

.connection-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-success);
  animation: pulse 2s ease-in-out infinite;
}

.connection-dot.disconnected {
  background: var(--accent-danger);
  animation: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Main Content */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Chat View */
.chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  padding-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}

.messages::-webkit-scrollbar {
  width: 6px;
}

.messages::-webkit-scrollbar-track {
  background: transparent;
}

.messages::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 3px;
}

/* Message Styles */
.message {
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: messageIn 0.3s ease-out;
}

@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message.assistant {
  align-items: flex-start;
}

.message.assistant .message-bubble {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  border-top-left-radius: 4px;
  max-width: 85%;
  padding: 14px 16px;
}

.message.user {
  align-items: flex-end;
}

.message.user .message-bubble {
  background: linear-gradient(135deg, var(--accent-primary), #06b6d4);
  color: var(--bg-primary);
  border-radius: var(--radius-lg);
  border-top-right-radius: 4px;
  max-width: 85%;
  padding: 14px 16px;
}

.message.tool {
  align-items: stretch;
}

.message.tool .tool-card {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-subtle);
}

.tool-icon {
  width: 24px;
  height: 24px;
  background: var(--accent-glow);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-primary);
  font-family: var(--font-mono);
}

.tool-input {
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
}

.message.result {
  padding-left: 12px;
  border-left: 2px solid var(--accent-success);
}

.message.result .result-content {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  font-size: 14px;
}

/* Empty State */
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 24px;
  gap: 12px;
}

.empty-icon {
  width: 64px;
  height: 64px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  margin-bottom: 8px;
}

.chat-empty h2 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.chat-empty p {
  font-size: 14px;
  color: var(--text-muted);
}

/* Permission Banner */
.permission-banner {
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.15), transparent);
  border-bottom: 1px solid rgba(239, 68, 68, 0.3);
  padding: 16px;
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.permission-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--accent-danger);
  margin-bottom: 12px;
  font-size: 14px;
}

.permission-details {
  background: var(--bg-secondary);
  padding: 12px;
  border-radius: var(--radius-md);
  margin-bottom: 12px;
  max-height: 150px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.permission-actions {
  display: flex;
  gap: 10px;
}

.permission-actions button {
  flex: 1;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.btn-allow {
  background: var(--accent-success);
  color: white;
}

.btn-allow:hover {
  background: #059669;
  transform: translateY(-1px);
}

.btn-deny {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}

.btn-deny:hover {
  background: var(--bg-elevated);
  border-color: var(--accent-danger);
  color: var(--accent-danger);
}

/* Composer */
.composer {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
}

.composer input {
  flex: 1;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-family: var(--font-display);
  transition: all var(--transition-fast);
}

.composer input::placeholder {
  color: var(--text-muted);
}

.composer input:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.composer button {
  width: 48px;
  height: 48px;
  background: var(--accent-primary);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.composer button:hover:not(:disabled) {
  background: #06b6d4;
  transform: scale(1.05);
}

.composer button:disabled {
  background: var(--bg-elevated);
  cursor: not-allowed;
  opacity: 0.5;
}

.composer button svg {
  width: 20px;
  height: 20px;
  color: var(--bg-primary);
}

/* Bottom Navigation */
.bottom-navbar {
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
  position: relative;
}

.nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.nav-header:active {
  background: var(--bg-tertiary);
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.nav-title {
  font-weight: 600;
  font-size: 14px;
}

.nav-count {
  background: var(--accent-primary);
  color: var(--bg-primary);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 700;
}

.nav-toggle {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  transition: transform var(--transition-fast);
}

.nav-toggle.open {
  transform: rotate(180deg);
}

.nav-content {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  padding: 0 16px 16px;
  max-height: 0;
  overflow: hidden;
  transition: all var(--transition-normal);
}

.nav-content.open {
  max-height: 300px;
  padding: 0 16px 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}

.session-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.session-card:active {
  transform: scale(0.98);
}

.session-card.active {
  border-color: var(--accent-primary);
  background: var(--accent-glow);
}

.session-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.session-status.running {
  background: var(--accent-success);
  box-shadow: 0 0 8px var(--accent-success);
}

.session-status.waiting,
.session-status.starting {
  background: var(--accent-warning);
  animation: pulse 1.5s ease-in-out infinite;
}

.session-status.stopped,
.session-status.paused {
  background: var(--text-muted);
}

.session-status.error {
  background: var(--accent-danger);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.session-delete {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
}

.session-card:hover .session-delete {
  opacity: 1;
}

.session-delete:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-danger);
}

/* Floating Action Button */
.fab {
  position: fixed;
  bottom: 80px;
  right: 20px;
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, var(--accent-primary), #06b6d4);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg), 0 0 20px var(--accent-glow);
  transition: all var(--transition-fast);
  z-index: 90;
}

.fab:active {
  transform: scale(0.95);
}

.fab svg {
  width: 24px;
  height: 24px;
  color: var(--bg-primary);
}

/* Loading */
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-default);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading a {
  color: var(--accent-primary);
  font-size: 14px;
}

/* Session Selection Screen */
.session-select {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px 20px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
}

.session-select h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 6px;
}

.session-select .subtitle {
  font-size: 15px;
  color: var(--text-muted);
  margin-bottom: 32px;
}

.create-btn {
  width: 100%;
  padding: 18px 24px;
  background: linear-gradient(135deg, var(--accent-primary), #06b6d4);
  border: none;
  border-radius: var(--radius-lg);
  color: var(--bg-primary);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-md), 0 0 30px var(--accent-glow);
  margin-bottom: 32px;
}

.create-btn:active {
  transform: scale(0.98);
}

.create-btn svg {
  width: 20px;
  height: 20px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.sessions-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

/* Responsive */
@media (min-width: 640px) {
  .sessions-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .nav-content {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .session-select {
    max-width: 480px;
    margin: 0 auto;
  }
}

@media (min-width: 768px) {
  .header {
    padding: 16px 24px;
  }
  
  .messages {
    padding: 24px;
    gap: 20px;
  }
  
  .composer {
    padding: 16px 24px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
  
  .session-select {
    padding: 40px;
  }
  
  .session-select h1 {
    font-size: 36px;
  }
}
`

const styleEl = document.createElement("style")
styleEl.textContent = styles
document.head.appendChild(styleEl)

const root = ReactDOM.createRoot(document.getElementById("root")!)
root.render(<App />)
