// Stable per-process identifier shared across logs and traces so a single
// nikcli invocation can be correlated in the OTLP backend.
export const runID = crypto.randomUUID().slice(0, 8)
