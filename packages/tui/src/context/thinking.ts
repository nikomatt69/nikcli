export function reasoningSummary(text: string): { title: string | null; body: string } {
  const content = text.trim()
  // `\s*$` keeps the title once `**Title**` has closed, including the
  // single trailing newline that arrives before the blank line. `$` alone
  // dropped the title for that one token — the header flickered off, then
  // back on when `\n\n` landed.
  const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|\s*$)/)
  if (!match) return { title: null, body: content }
  return { title: match[1].trim(), body: content.slice(match[0].length).trimEnd() }
}
