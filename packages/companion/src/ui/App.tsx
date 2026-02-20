import React, { useEffect, useRef, useState } from "react"
import { store, useStore, Message, Session } from "./store"

function MessageBubble({ message }: { message: Message }) {
  const isTool = message.type === "tool_use"
  const isResult = message.type === "tool_result" || message.type === "result"

  if (isTool) {
    return (
      <div className="message tool">
        <div className="message-header">
          <span className="tool-icon">🔧</span>
          <span className="tool-name">{message.toolName}</span>
        </div>
        <pre className="tool-input">{JSON.stringify(message.toolInput, null, 2)}</pre>
      </div>
    )
  }

  if (isResult) {
    return (
      <div className="message result">
        <div className="message-content">
          {message.toolResult ? <pre>{JSON.stringify(message.toolResult, null, 2)}</pre> : message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="message assistant">
      <div className="message-content">{message.content}</div>
    </div>
  )
}

function ChatView() {
  const messages = useStore((s) => s.messages)
  const input = useStore((s) => s.input)
  const connected = useStore((s) => s.connected)
  const setInput = useStore((s) => s.setInput)
  const sendMessage = useStore((s) => s.sendMessage)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !connected) return
    sendMessage(input)
    setInput("")
  }

  return (
    <div className="chat-view">
      {messages.length === 0 ? (
        <div className="chat-empty">
          <h2>Start a conversation</h2>
          <p>Send a message to begin</p>
        </div>
      ) : (
        <div className="messages">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}
      <form className="composer" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={connected ? "Type a message..." : "Connecting..."}
          disabled={!connected}
        />
        <button type="submit" disabled={!connected || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

function PermissionBanner() {
  const pendingPermissions = useStore((s) => s.pendingPermissions)
  const respondToPermission = useStore((s) => s.respondToPermission)

  if (pendingPermissions.length === 0) return null

  const permission = pendingPermissions[0]

  return (
    <div className="permission-banner">
      <div className="permission-title">
        <span className="icon">⚠️</span>
        Permission Request: {permission.tool_name}
      </div>
      <div className="permission-details">
        <pre>{JSON.stringify(permission.input, null, 2)}</pre>
      </div>
      <div className="permission-actions">
        <button className="btn-deny" onClick={() => respondToPermission(permission.request_id, false)}>
          Deny
        </button>
        <button className="btn-allow" onClick={() => respondToPermission(permission.request_id, true)}>
          Allow
        </button>
      </div>
    </div>
  )
}

function BottomNavbar() {
  const sessions = useStore((s) => s.sessions)
  const sessionId = useStore((s) => s.sessionId)
  const connect = useStore((s) => s.connect)
  const [isExpanded, setIsExpanded] = useState(false)

  const handleSessionClick = (id: string) => {
    if (id !== sessionId) {
      connect(id)
      setIsExpanded(false)
    }
  }

  const formatSessionName = (session: Session | any) => {
    // Try to get a meaningful name from messages
    if (session.messages && Array.isArray(session.messages) && session.messages.length > 0) {
      // Look for user message
      const firstUserMessage = session.messages.find((m: any) => {
        if (m.type === "user") return true
        if (m.message?.role === "user") return true
        return false
      })
      
      if (firstUserMessage) {
        let content = ""
        if (typeof firstUserMessage.message?.content === "string") {
          content = firstUserMessage.message.content
        } else if (Array.isArray(firstUserMessage.message?.content)) {
          const textBlock = firstUserMessage.message.content.find((c: any) => c.type === "text" || c.text)
          content = textBlock?.text || textBlock?.content || ""
        } else if (firstUserMessage.content) {
          content = typeof firstUserMessage.content === "string" 
            ? firstUserMessage.content 
            : firstUserMessage.content[0]?.text || ""
        }
        
        if (content && content.trim()) {
          return content.trim().slice(0, 50) + (content.length > 50 ? "..." : "")
        }
      }
    }
    
    // Fallback to session ID or created date
    if (session.createdAt) {
      const date = new Date(session.createdAt)
      return `Session - ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
    }
    
    return `Session ${session.id.slice(0, 8)}`
  }

  return (
    <div className={`bottom-navbar ${isExpanded ? "expanded" : ""}`}>
      <div className="bottom-navbar-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="navbar-title">Sessions</span>
        <span className="navbar-count">{sessions.length}</span>
        <span className="navbar-toggle">{isExpanded ? "▼" : "▲"}</span>
      </div>
      {isExpanded && (
        <div className="bottom-navbar-content">
          <div className="sessions-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`session-item ${session.id === sessionId ? "active" : ""}`}
                onClick={() => handleSessionClick(session.id)}
              >
                <span className="session-status" data-status={session.status}></span>
                <span className="session-name">{formatSessionName(session)}</span>
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="sessions-empty">No sessions available</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function App() {
  const sessionId = useStore((s) => s.sessionId)
  const connect = useStore((s) => s.connect)
  const setSessions = useStore((s) => s.setSessions)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const session = params.get("session")
    if (session) {
      connect(session)
    }
  }, [])

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch("/companion/api/sessions")
        const sessions = await response.json()
        setSessions(sessions)
      } catch (error) {
        console.error("Failed to fetch sessions:", error)
      }
    }

    fetchSessions()
    const interval = setInterval(fetchSessions, 5000) // Refresh every 5 seconds

    return () => clearInterval(interval)
  }, [setSessions])

  if (!sessionId) {
    return (
      <div className="loading">
        <p>Loading...</p>
        <a href="/">Go to Home</a>
      </div>
    )
  }

  return (
    <div className="app">
      <main className="main">
        <PermissionBanner />
        <ChatView />
      </main>
      <BottomNavbar />
    </div>
  )
}
