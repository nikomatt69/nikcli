---
name: text-to-cad
description: Generate 3D CAD models from natural language descriptions using AI. Integrates with Zoo.dev (KittyCAD) API and similar text-to-CAD services. Use this when the user wants to create CAD geometry, solid models, or parametric designs from a text prompt.
category: metalworking
tags:
  - cad
  - 3d-modeling
  - generative
  - solidworks
  - fusion360
  - step
  - iges
version: 1.0.0
---

# Text-to-CAD

Generate 3D CAD models from natural language descriptions. This skill covers how to use text-to-CAD AI services and integrate the resulting geometry into SolidWorks, Fusion 360, FreeCAD, and other CAD tools.

## Primary API: Zoo.dev (KittyCAD)

The leading text-to-CAD API. Accepts natural language and returns STEP, GLTF, OBJ, or STL files.

```
Base URL: https://api.zoo.dev
Auth: Bearer token via ZOO_API_TOKEN env var
```

### Generate a model (async)

```bash
curl -X POST https://api.zoo.dev/ai/text-to-cad \
  -H "Authorization: Bearer $ZOO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A steel bracket with two M6 mounting holes, 60mm x 40mm x 5mm",
    "output_format": "step"
  }'
# Returns: { "id": "<job_id>", "status": "queued" }
```

### Poll for result

```bash
curl https://api.zoo.dev/async/operations/<job_id> \
  -H "Authorization: Bearer $ZOO_API_TOKEN"
# When status == "completed": outputs["source.step"] contains base64 STEP data
```

### Decode and save

```bash
echo "<base64_step_data>" | base64 -d > model.step
```

### Full Node.js workflow

```typescript
import fs from "fs/promises"

const API = "https://api.zoo.dev"
const TOKEN = process.env.ZOO_API_TOKEN

async function textToCAD(prompt: string, format = "step"): Promise<Buffer> {
  const res = await fetch(`${API}/ai/text-to-cad/${format}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
  const { id } = await res.json()

  // Poll until done
  while (true) {
    await new Promise((r) => setTimeout(r, 2000))
    const poll = await fetch(`${API}/async/operations/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const data = await poll.json()
    if (data.status === "completed") {
      const b64 = data.outputs["source.step"]
      return Buffer.from(b64, "base64")
    }
    if (data.status === "failed") throw new Error(data.error ?? "Generation failed")
  }
}

const buffer = await textToCAD("Aluminum flanged shaft collar, 25mm bore, 50mm OD")
await fs.writeFile("collar.step", buffer)
```

## Prompt engineering for metalworking

Effective prompts include:
- **Material**: aluminum 6061, steel 1045, stainless 316L, titanium grade 5
- **Dimensions**: always include units (mm preferred), tolerances where critical
- **Features**: holes (specify diameter and depth), threads (M6x1.0), fillets (R2mm), chamfers
- **Standard references**: ISO 4762, DIN 912, ASME B18.3 for fasteners
- **Finish**: anodized, zinc-plated, passivated

### Example prompts

```
Good: "A 6061 aluminum mounting plate 120mm x 80mm x 8mm with four M5 through-holes 
       at 10mm from each corner. Center pocket 60mm x 40mm x 4mm deep with R3mm corner fillets."

Bad: "A metal part with some holes"
```

## Import into SolidWorks

```vba
' Import STEP file via SolidWorks API
Dim swApp As SldWorks.SldWorks
Dim swModel As SldWorks.ModelDoc2

Set swApp = Application.SldWorks
Dim importData As SldWorks.ImportStepData
Set importData = swApp.GetImportFileData("C:\parts\model.step")
importData.MergeEntities = True

Dim errors As Long, warnings As Long
Set swModel = swApp.LoadFile4("C:\parts\model.step", "", importData, errors, warnings)
```

## Import into Fusion 360

```python
import adsk.core, adsk.fusion

def import_step(step_path: str):
    app = adsk.core.Application.get()
    ui = app.userInterface
    design = app.activeProduct
    
    import_mgr = app.importManager
    step_options = import_mgr.createSTEPImportOptions(step_path)
    import_mgr.importToNewDocument(step_options)
```

## Alternative services

| Service | Endpoint | Notes |
|---------|----------|-------|
| Zoo.dev | api.zoo.dev | Best quality, STEP/GLTF output |
| TripoAI | api.tripo3d.ai | Fast, mesh-focused |
| Meshy | api.meshy.ai | Good for organic shapes |

## Output format guidance

- **STEP (.step/.stp)** — Use for SolidWorks, Fusion, CATIA. Preserves parametric info.
- **IGES (.igs/.iges)** — Legacy interchange; use STEP when possible.
- **STL (.stl)** — For 3D printing and mesh analysis only; no parametric data.
- **OBJ (.obj)** — Visualization and rendering, not for machining.

## Checklist

- Set `ZOO_API_TOKEN` in environment before running
- Always validate output geometry: check for open shells, non-manifold edges
- For machining: import to CAM software and verify wall thickness ≥ 0.5mm
- For 3D printing: run mesh repair (e.g., Meshmixer) before slicing
