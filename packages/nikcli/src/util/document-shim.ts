import { characterEntities } from "character-entities"

/**
 * Minimal `document` shim for Bun server processes.
 *
 * The CLI runs under `--conditions=browser` (the `dev` script and
 * `script/build.ts`), so packages that publish a browser build resolve to it.
 * The one that broke the `bot` command is `decode-named-character-reference`:
 * its dom build runs `document.createElement("i")` at module top level, and
 * Bun has no DOM, so importing the chatbot module crashed with
 * `document is not defined`.
 *
 * The only consumer in that chain assigns `innerHTML` a single character
 * reference (`&name;`) and reads `textContent` back, so this shim decodes
 * named and numeric character references using the same table the package's
 * node build uses (`character-entities`). It is a no-op in browsers, where a
 * real `document` already exists.
 */

const own = {}.hasOwnProperty

type ShimElement = {
  text: string
  set innerHTML(value: string)
  get textContent(): string
}

function decodeCharacterReferences(html: string): string {
  return html.replace(/&(#[0-9]{1,7}|#x[\da-fA-F]{1,6}|[\da-zA-Z]{1,31});/g, (reference, body) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X"
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (Number.isNaN(code)) return reference
      try {
        return String.fromCodePoint(code)
      } catch {
        // Out-of-range code point: the HTML spec replaces it with U+FFFD.
        return "\uFFFD"
      }
    }
    return own.call(characterEntities, body) ? characterEntities[body] : reference
  })
}

if (typeof document === "undefined") {
  const element: ShimElement = {
    text: "",
    set innerHTML(value: string) {
      this.text = decodeCharacterReferences(value)
    },
    get textContent() {
      return this.text
    },
  }

  Object.defineProperty(globalThis, "document", {
    value: {
      createElement(_tag: string) {
        return element
      },
    },
    configurable: true,
    writable: false,
  })
}
