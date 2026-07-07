// Pure model-string parsing, extracted so the TUI process can parse
// "provider/model" identifiers without evaluating the full provider
// registry (which statically loads every AI SDK package).
export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: providerID,
    modelID: rest.join("/"),
  }
}
