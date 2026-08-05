/**
 * Layout constants shared across the session chrome.
 *
 * These exist because two places have to agree on a number and neither can see
 * the other. The sidebar sets its own width; the transcript subtracts that same
 * width to work out how much room it has left. When the two were both spelled
 * `42`, changing one silently mis-sized the other.
 *
 * Ported from opencode's `ui/layout.ts`, minus `sessionTabsFitVertically` —
 * nikcli's session tabs make no equivalent orientation decision, so bringing it
 * across would be a function with no caller.
 */

/** Width of the session sidebar, in columns. */
export const SESSION_SIDEBAR_WIDTH = 42
