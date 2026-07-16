/**
 * Minimal markdown → HTML renderer for the artifact viewer. Covers the
 * common subset (headings, fences, lists, quotes, links, emphasis, hr,
 * inline code) without pulling a markdown dependency into the worker.
 * Everything is HTML-escaped first, so raw HTML in the source stays inert.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>")
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>')
  return out
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const html: string[] = []
  let inFence = false
  let fenceBuffer: string[] = []
  let listType: "ul" | "ol" | null = null
  let paragraph: string[] = []

  function closeParagraph() {
    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(" "))}</p>`)
      paragraph = []
    }
  }

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  for (const line of lines) {
    if (inFence) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(fenceBuffer.join("\n"))}</code></pre>`)
        fenceBuffer = []
        inFence = false
      } else {
        fenceBuffer.push(line)
      }
      continue
    }

    if (/^```/.test(line)) {
      closeParagraph()
      closeList()
      inFence = true
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeParagraph()
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeParagraph()
      closeList()
      html.push("<hr/>")
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      closeParagraph()
      closeList()
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`)
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      closeParagraph()
      const type = bullet ? "ul" : "ol"
      if (listType !== type) {
        closeList()
        html.push(`<${type}>`)
        listType = type
      }
      html.push(`<li>${renderInline((bullet ?? ordered)![1])}</li>`)
      continue
    }

    if (!line.trim()) {
      closeParagraph()
      closeList()
      continue
    }

    paragraph.push(line.trim())
  }

  if (inFence && fenceBuffer.length) {
    html.push(`<pre><code>${escapeHtml(fenceBuffer.join("\n"))}</code></pre>`)
  }
  closeParagraph()
  closeList()
  return html.join("\n")
}
