import React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ChatMessage } from "../stores/aiStore"
import { CodeBlock } from "./CodeBlock"
import { formatDuration, pickVerbPair } from "./ThinkingBubble"

const MARKDOWN_COMPONENTS = {
  code({ inline, className, children, ...props }: {
    inline?: boolean
    className?: string
    children?: React.ReactNode
  } & Record<string, unknown>): JSX.Element {
    const text = String(children ?? "").replace(/\n$/, "")
    // react-markdown v9 dropped the inline prop — detect inline by
    // absence of a fenced `language-*` class AND no newline in body.
    const hasLangClass = /language-\w+/.test(className ?? "")
    const hasNewline = text.includes("\n")
    const isInline = inline ?? (!hasLangClass && !hasNewline)
    if (isInline) {
      return (
        <code
          className={className}
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 4,
            padding: "1px 5px",
            fontSize: "0.9em",
            fontFamily: "var(--font-mono, ui-monospace, monospace)"
          }}
          {...props}
        >
          {children}
        </code>
      )
    }
    const lang = /language-(\w+)/.exec(className || "")?.[1] || "lua"
    return <CodeBlock code={text} lang={lang} />
  },
  pre({ children }: { children?: React.ReactNode }): JSX.Element {
    return <>{children}</>
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }): JSX.Element {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--accent)", textDecoration: "underline" }}
      >
        {children}
      </a>
    )
  },
  ul({ children }: { children?: React.ReactNode }): JSX.Element {
    return <ul style={{ margin: "4px 0", paddingLeft: 18, listStyle: "disc" }}>{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }): JSX.Element {
    return <ol style={{ margin: "4px 0", paddingLeft: 18, listStyle: "decimal" }}>{children}</ol>
  },
  li({ children }: { children?: React.ReactNode }): JSX.Element {
    return <li style={{ margin: "2px 0" }}>{children}</li>
  },
  p({ children }: { children?: React.ReactNode }): JSX.Element {
    return <p style={{ margin: "6px 0" }}>{children}</p>
  },
  h1({ children }: { children?: React.ReactNode }): JSX.Element {
    return <h1 style={{ fontSize: "1.25em", fontWeight: 600, margin: "10px 0 4px" }}>{children}</h1>
  },
  h2({ children }: { children?: React.ReactNode }): JSX.Element {
    return <h2 style={{ fontSize: "1.15em", fontWeight: 600, margin: "10px 0 4px" }}>{children}</h2>
  },
  h3({ children }: { children?: React.ReactNode }): JSX.Element {
    return <h3 style={{ fontSize: "1.05em", fontWeight: 600, margin: "8px 0 4px" }}>{children}</h3>
  },
  blockquote({ children }: { children?: React.ReactNode }): JSX.Element {
    return (
      <blockquote
        style={{
          borderLeft: "3px solid var(--border-subtle)",
          paddingLeft: 8,
          margin: "4px 0",
          color: "var(--text-secondary)"
        }}
      >
        {children}
      </blockquote>
    )
  },
  table({ children }: { children?: React.ReactNode }): JSX.Element {
    return (
      <table style={{ borderCollapse: "collapse", margin: "4px 0", fontSize: "0.95em" }}>
        {children}
      </table>
    )
  },
  th({ children }: { children?: React.ReactNode }): JSX.Element {
    return (
      <th style={{ border: "1px solid var(--border-subtle)", padding: "3px 6px", textAlign: "left" }}>
        {children}
      </th>
    )
  },
  td({ children }: { children?: React.ReactNode }): JSX.Element {
    return (
      <td style={{ border: "1px solid var(--border-subtle)", padding: "3px 6px" }}>
        {children}
      </td>
    )
  }
} as const

/**
 * Message row — two modes:
 * - User: right-aligned subtle bubble (author distinction).
 * - Assistant: FLAT prose, no container, no background — like Claude Code's
 *   CLI output. The surrounding ChatPanel gutter provides breathing room.
 */
/**
 * Standalone footer — "✻ {Past} for Xs · ↑1.5k ↓0.3k".
 * Exported so ChatPanel can relocate it below the tool group when an assistant
 * turn fired tools (CC-style: footer goes at the very end of the turn).
 */
export function MessageFooter({ message }: { message: ChatMessage }): JSX.Element | null {
  const [, pastTense] = pickVerbPair(message.id)
  const hasTokens = (message.inputTokens ?? 0) > 0 || (message.outputTokens ?? 0) > 0
  const hasThinking = message.thinkingSeconds !== undefined && message.thinkingSeconds > 0
  // While the message is still streaming, the ChatPanel's turn-status line
  // already shows live ✶ {verb}… (elapsed · tokens). Suppress the footer to
  // avoid showing two indicators at once.
  if (message.streaming) return null
  if (!hasThinking && !hasTokens) return null

  return (
    <div
      className="flex items-center gap-2 mt-3"
      style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}
      title={
        hasTokens
          ? `Input: ${(message.inputTokens ?? 0).toLocaleString()} tokens\nOutput: ${(message.outputTokens ?? 0).toLocaleString()} tokens\nCache read: ${(message.cacheTokens ?? 0).toLocaleString()} tokens`
          : undefined
      }
    >
      {hasThinking && (
        <>
          <span aria-hidden style={{ color: "var(--accent)", fontSize: 13 }}>✻</span>
          <span>{pastTense} for {formatDuration(message.thinkingSeconds ?? 0)}</span>
        </>
      )}
      {hasTokens && (
        <>
          {hasThinking && <span style={{ opacity: 0.5 }}>·</span>}
          <span>↑{((message.inputTokens ?? 0) / 1000).toFixed(1)}k</span>
          <span>↓{((message.outputTokens ?? 0) / 1000).toFixed(1)}k</span>
        </>
      )}
    </div>
  )
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
  hideFooter
}: { message: ChatMessage; hideFooter?: boolean }): JSX.Element {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <div className="flex justify-end animate-slide-up">
        <div
          className="max-w-full rounded-xl px-3 py-2 selectable"
          style={{
            fontSize: "13px",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "var(--accent-muted)",
            border: "1px solid var(--accent-glow, var(--border-subtle))",
            color: "var(--text-primary)"
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant: flat, no container.
  const hasContent = Boolean(message.content)

  return (
    <div
      className="max-w-full w-full selectable markdown-body animate-slide-up"
      style={{
        fontSize: "13px",
        lineHeight: "1.65",
        wordBreak: "break-word",
        color: "var(--text-primary)",
        padding: "2px 2px"
      }}
    >
      {hasContent ? (
        <>
          {/* @ts-expect-error react-markdown component prop typing is loose */}
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {message.content}
          </ReactMarkdown>
        </>
      ) : null}

      {!hideFooter && <MessageFooter message={message} />}
    </div>
  )
})
