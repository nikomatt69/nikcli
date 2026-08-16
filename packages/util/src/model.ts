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

/** Inverse of `parseModel`: serialise a model id back to "providerID/modelID". */
export function stringifyModel(model: { providerID: string; modelID: string }): string {
  return `${model.providerID}/${model.modelID}`
}
