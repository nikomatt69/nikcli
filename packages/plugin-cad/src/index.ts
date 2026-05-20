import type { Plugin } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin/tool"

// ---------------------------------------------------------------------------
// Machining calculator
// ---------------------------------------------------------------------------

const machiningCalculator = tool({
  description:
    "Calculate CNC machining parameters: cutting speed, RPM, feed rate, material removal rate. " +
    "Use when the user needs feeds and speeds for a given tool, material, and operation.",
  args: {
    material: tool.schema
      .enum([
        "aluminum-6061",
        "aluminum-7075",
        "steel-1045",
        "steel-4140",
        "stainless-304",
        "stainless-316",
        "titanium-grade5",
        "brass-c360",
        "copper",
        "abs-plastic",
      ])
      .describe("Workpiece material"),
    tool_diameter_mm: tool.schema.number().positive().describe("Cutting tool diameter in millimeters"),
    operation: tool.schema
      .enum(["roughing", "semi-finishing", "finishing", "drilling", "tapping", "reaming"])
      .describe("Machining operation type"),
    num_flutes: tool.schema
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .default(4)
      .describe("Number of flutes (default: 4)"),
    axial_depth_mm: tool.schema.number().positive().optional().describe("Axial depth of cut (ap) in mm"),
    radial_depth_mm: tool.schema.number().positive().optional().describe("Radial depth of cut (ae) in mm"),
  },
  async execute(args) {
    const params = MATERIAL_PARAMS[args.material]
    if (!params) return `Unknown material: ${args.material}`

    const D = args.tool_diameter_mm
    const z = args.num_flutes ?? 4
    const op = args.operation

    const vc = params.vc[op] ?? params.vc["roughing"]
    const fz = params.fz[op] ?? params.fz["roughing"]

    const rpm = Math.round((vc * 1000) / (Math.PI * D))
    const feed = Math.round(rpm * z * fz)
    const vf = feed

    const ap = args.axial_depth_mm ?? defaultAP(D, op)
    const ae = args.radial_depth_mm ?? defaultAE(D, op)
    const mrr = (ae * ap * vf) / 1000

    const lines = [
      `## Machining Parameters`,
      ``,
      `**Material**: ${args.material}`,
      `**Tool**: ⌀${D}mm, ${z}-flute endmill`,
      `**Operation**: ${op}`,
      ``,
      `### Recommended Parameters`,
      ``,
      `| Parameter | Value |`,
      `|-----------|-------|`,
      `| Cutting speed (Vc) | ${vc} m/min |`,
      `| Spindle speed (n) | ${rpm.toLocaleString()} RPM |`,
      `| Chip load (fz) | ${fz} mm/tooth |`,
      `| Feed rate (Vf) | ${feed} mm/min |`,
      `| Axial depth (ap) | ${ap} mm |`,
      `| Radial depth (ae) | ${ae} mm |`,
      `| MRR | ${mrr.toFixed(1)} cm³/min |`,
      ``,
      `### G-code snippet`,
      ``,
      "```gcode",
      `S${rpm} M03       ; Spindle on`,
      `M08              ; Coolant on`,
      `G01 Z-${ap.toFixed(1)} F${Math.round(feed * 0.3)}   ; Plunge`,
      `G01 X... F${feed}   ; Cut`,
      "```",
      ``,
      `### Notes`,
      ...params.notes.map((n: string) => `- ${n}`),
    ]

    return lines.join("\n")
  },
})

// ---------------------------------------------------------------------------
// Material database
// ---------------------------------------------------------------------------

const materialLookup = tool({
  description:
    "Look up mechanical and machining properties for common metalworking materials. " +
    "Returns tensile strength, hardness, machinability rating, thermal conductivity, and recommended coatings.",
  args: {
    material: tool.schema
      .string()
      .describe(
        "Material name or alloy designation (e.g. '6061-T6', 'steel 1045', 'stainless 316L', 'titanium grade 5')",
      ),
  },
  async execute(args) {
    const query = args.material.toLowerCase().replace(/[-\s]+/g, "")
    const entry = findMaterial(query)
    if (!entry) {
      return (
        `Material "${args.material}" not found in database.\n` +
        `Available: ${Object.keys(MATERIAL_DB).join(", ")}`
      )
    }

    const lines = [
      `## ${entry.name}`,
      ``,
      `**Designation**: ${entry.designation}`,
      `**Category**: ${entry.category}`,
      ``,
      `### Mechanical Properties`,
      ``,
      `| Property | Value |`,
      `|----------|-------|`,
      `| Tensile strength | ${entry.tensileStrength} MPa |`,
      `| Yield strength | ${entry.yieldStrength} MPa |`,
      `| Hardness | ${entry.hardness} |`,
      `| Density | ${entry.density} g/cm³ |`,
      `| Elastic modulus | ${entry.elasticModulus} GPa |`,
      ``,
      `### Machining`,
      ``,
      `| Property | Value |`,
      `|----------|-------|`,
      `| Machinability | ${entry.machinability}/100 |`,
      `| Recommended Vc | ${entry.vcRange} m/min |`,
      `| Coolant | ${entry.coolant} |`,
      `| Tool coating | ${entry.toolCoating} |`,
      ``,
      `### Surface Treatments`,
      ``,
      ...entry.treatments.map((t: string) => `- ${t}`),
      ``,
      `### Common Applications`,
      ``,
      ...entry.applications.map((a: string) => `- ${a}`),
    ]

    return lines.join("\n")
  },
})

// ---------------------------------------------------------------------------
// G-code validator
// ---------------------------------------------------------------------------

const gcodeValidate = tool({
  description:
    "Validate G-code for syntax errors, missing safety blocks, and common machining mistakes. " +
    "Reports issues by line number with descriptions and suggested fixes.",
  args: {
    gcode: tool.schema.string().describe("G-code program text to validate"),
    controller: tool.schema
      .enum(["fanuc", "heidenhain", "siemens-840d", "haas", "generic"])
      .optional()
      .default("fanuc")
      .describe("CNC controller dialect (default: fanuc)"),
  },
  async execute(args) {
    const issues = validateGCode(args.gcode, args.controller ?? "fanuc")
    const lines = args.gcode.split("\n")

    if (issues.length === 0) {
      return [
        `## G-Code Validation: PASSED ✓`,
        ``,
        `Controller: ${args.controller ?? "fanuc"}`,
        `Lines analyzed: ${lines.length}`,
        `No issues found.`,
      ].join("\n")
    }

    const errors = issues.filter((i) => i.severity === "error")
    const warnings = issues.filter((i) => i.severity === "warning")

    const out = [
      `## G-Code Validation: ${errors.length > 0 ? "FAILED ✗" : "PASSED WITH WARNINGS ⚠"}`,
      ``,
      `Controller: ${args.controller ?? "fanuc"}  |  Lines: ${lines.length}  |  Errors: ${errors.length}  |  Warnings: ${warnings.length}`,
      ``,
    ]

    if (errors.length > 0) {
      out.push(`### Errors (must fix)`, ``)
      for (const issue of errors) {
        out.push(`**Line ${issue.line}**: ${issue.message}`)
        if (issue.fix) out.push(`  → Fix: ${issue.fix}`)
        out.push(`  \`${lines[issue.line - 1]?.trim() ?? ""}\``, ``)
      }
    }

    if (warnings.length > 0) {
      out.push(`### Warnings (review)`, ``)
      for (const issue of warnings) {
        out.push(`**Line ${issue.line}**: ${issue.message}`)
        if (issue.fix) out.push(`  → Fix: ${issue.fix}`)
        out.push(`  \`${lines[issue.line - 1]?.trim() ?? ""}\``, ``)
      }
    }

    return out.join("\n")
  },
})

// ---------------------------------------------------------------------------
// Text-to-CAD bridge
// ---------------------------------------------------------------------------

const textToCAD = tool({
  description:
    "Generate a 3D CAD model from a natural language description using the Zoo.dev (KittyCAD) API. " +
    "Returns a STEP file. Requires ZOO_API_TOKEN environment variable. " +
    "Use for rapid prototyping when the user describes a part in words.",
  args: {
    prompt: tool.schema
      .string()
      .min(10)
      .describe(
        "Detailed description of the part. Include material, dimensions (with units), features like holes, threads, fillets.",
      ),
    output_format: tool.schema
      .enum(["step", "stl", "obj", "gltf"])
      .optional()
      .default("step")
      .describe("Output file format (default: step)"),
    output_path: tool.schema.string().optional().describe("Path to save the output file (optional)"),
  },
  async execute(args, ctx) {
    const token = process.env.ZOO_API_TOKEN
    if (!token) {
      return [
        `## Text-to-CAD: Missing API Token`,
        ``,
        `Set the \`ZOO_API_TOKEN\` environment variable to use this tool.`,
        ``,
        `Get a free token at: https://zoo.dev`,
        ``,
        "```bash",
        `export ZOO_API_TOKEN=your_token_here`,
        "```",
      ].join("\n")
    }

    const format = args.output_format ?? "step"
    ctx.metadata({ title: `Generating ${format.toUpperCase()} from text...` })

    try {
      const createRes = await fetch(`https://api.zoo.dev/ai/text-to-cad/${format}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: args.prompt }),
        signal: ctx.abort,
      })

      if (!createRes.ok) {
        const err = await createRes.text()
        return `## Text-to-CAD: API Error\n\n${createRes.status} ${createRes.statusText}\n\n${err}`
      }

      const { id } = (await createRes.json()) as { id: string }

      // Poll for completion
      let attempts = 0
      while (attempts < 60) {
        await new Promise((r) => setTimeout(r, 3000))
        attempts++

        const pollRes = await fetch(`https://api.zoo.dev/async/operations/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctx.abort,
        })
        const data = (await pollRes.json()) as {
          status: string
          outputs?: Record<string, string>
          error?: string
        }

        if (data.status === "failed") {
          return `## Text-to-CAD: Generation Failed\n\n${data.error ?? "Unknown error"}`
        }

        if (data.status === "completed" && data.outputs) {
          const key = `source.${format}`
          const b64 = data.outputs[key]
          if (!b64) {
            return `## Text-to-CAD: No output in response (expected key: ${key})`
          }

          const outPath = args.output_path ?? `./model.${format}`
          const buffer = Buffer.from(b64, "base64")
          await Bun.write(outPath, buffer)

          return [
            `## Text-to-CAD: Complete ✓`,
            ``,
            `**Prompt**: ${args.prompt}`,
            `**Format**: ${format.toUpperCase()}`,
            `**Output**: \`${outPath}\` (${(buffer.length / 1024).toFixed(1)} KB)`,
            `**Job ID**: ${id}`,
            ``,
            `The model has been saved. Next steps:`,
            `- Import into SolidWorks: File → Open → select \`${outPath}\``,
            `- Import into Fusion 360: Insert → Import → STEP`,
            `- Use skill \`solidworks-automation\` or \`fusion360-api\` for further automation`,
          ].join("\n")
        }

        ctx.metadata({ title: `Generating ${format.toUpperCase()}... (${attempts * 3}s)` })
      }

      return `## Text-to-CAD: Timeout\n\nJob ${id} did not complete within 3 minutes.`
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "Text-to-CAD cancelled."
      return `## Text-to-CAD: Error\n\n${err instanceof Error ? err.message : String(err)}`
    }
  },
})

// ---------------------------------------------------------------------------
// Toolpath advisor
// ---------------------------------------------------------------------------

const toolpathAdvisor = tool({
  description:
    "Recommend machining strategies and toolpath types for a given part feature and CAM software. " +
    "Use when the user is deciding how to machine a specific feature (pocket, bore, contour, 5-axis surface).",
  args: {
    feature_type: tool.schema
      .enum([
        "open-pocket",
        "closed-pocket",
        "external-profile",
        "bore",
        "face",
        "complex-surface",
        "5-axis-port",
        "thread-mill",
        "deep-slot",
      ])
      .describe("Type of geometric feature to machine"),
    material: tool.schema
      .enum(["aluminum", "steel", "stainless", "titanium", "plastic"])
      .describe("Workpiece material family"),
    cam_software: tool.schema
      .enum(["hypermill", "fusion360", "mastercam", "solidcam", "nx-cam", "generic"])
      .optional()
      .default("generic")
      .describe("CAM software being used"),
    tolerance_mm: tool.schema
      .number()
      .positive()
      .optional()
      .describe("Required dimensional tolerance in mm (e.g. 0.05)"),
    surface_finish_ra: tool.schema
      .number()
      .positive()
      .optional()
      .describe("Required surface roughness Ra in μm (e.g. 1.6)"),
  },
  async execute(args) {
    const advice = TOOLPATH_ADVICE[args.feature_type]
    if (!advice) return `No advice available for feature type: ${args.feature_type}`

    const lines = [
      `## Toolpath Recommendation: ${args.feature_type}`,
      ``,
      `**Material**: ${args.material}`,
      `**CAM**: ${args.cam_software ?? "generic"}`,
      args.tolerance_mm ? `**Tolerance**: ±${args.tolerance_mm}mm` : null,
      args.surface_finish_ra ? `**Surface finish**: Ra ${args.surface_finish_ra}μm` : null,
      ``,
      `### Recommended Strategy`,
      ``,
      `**Primary**: ${advice.primary}`,
      `**Alternative**: ${advice.alternative}`,
      ``,
      `### Setup`,
      ``,
      ...advice.setup.map((s: string) => `- ${s}`),
      ``,
      `### Parameters`,
      ``,
      ...advice.parameters
        .map((p: { name: string; value: string; note?: string }) => `- **${p.name}**: ${p.value}${p.note ? ` _(${p.note})_` : ""}`)
        .filter(Boolean),
      ``,
    ]

    if (args.cam_software && args.cam_software !== "generic") {
      const camNote = CAM_STRATEGY_NAMES[args.cam_software]?.[args.feature_type]
      if (camNote) {
        lines.push(`### ${args.cam_software} Strategy Name`, ``, `\`${camNote}\``, ``)
      }
    }

    if (args.surface_finish_ra && args.surface_finish_ra < 1.6) {
      lines.push(
        `### Finishing Note`,
        ``,
        `Ra ${args.surface_finish_ra}μm requires:`,
        `- Dedicated finishing pass with fresh tool`,
        `- Step-over ≤ 0.1mm (ball-nose)`,
        `- Reduce feed 30% from calculated`,
        args.surface_finish_ra < 0.8 ? `- Consider grinding or polishing after machining` : null,
        ``,
      )
    }

    return lines.filter((l) => l !== null).join("\n")
  },
})

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const server: Plugin = async () => {
  return {
    tool: {
      machining_calculator: machiningCalculator,
      material_lookup: materialLookup,
      gcode_validate: gcodeValidate,
      text_to_cad: textToCAD,
      toolpath_advisor: toolpathAdvisor,
    },
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        [
          "## Metalworking & CAD Mode",
          "You have native metalworking and CAD capabilities through specialized tools:",
          "- `machining_calculator`: feeds, speeds, RPM for any material and operation",
          "- `material_lookup`: mechanical properties and machinability data",
          "- `gcode_validate`: validate NC programs before sending to machine",
          "- `text_to_cad`: generate 3D STEP models from text descriptions (requires ZOO_API_TOKEN)",
          "- `toolpath_advisor`: CAM strategy recommendations per feature type",
          "",
          "Skills available: text-to-cad, solidworks-automation, fusion360-api, hypermill-cam, cnc-gcode, metalworking-dfm, cad-formats",
          "Use the `skill` tool to load detailed guidance for any of these skills.",
        ].join("\n"),
      )
    },
  }
}

export default { server }

// ---------------------------------------------------------------------------
// Data tables
// ---------------------------------------------------------------------------

interface MaterialParams {
  vc: Record<string, number>
  fz: Record<string, number>
  notes: string[]
}

const MATERIAL_PARAMS: Record<string, MaterialParams> = {
  "aluminum-6061": {
    vc: { roughing: 300, "semi-finishing": 400, finishing: 500, drilling: 100, tapping: 20, reaming: 150 },
    fz: { roughing: 0.06, "semi-finishing": 0.04, finishing: 0.02, drilling: 0.03, tapping: 1.0, reaming: 0.01 },
    notes: [
      "Use sharp uncoated or ZrN-coated carbide tools",
      "Flood coolant or MQL; avoid dry if possible",
      "High helix angle (45°) reduces chip re-cutting",
      "HSS tools acceptable for low volumes",
    ],
  },
  "aluminum-7075": {
    vc: { roughing: 250, "semi-finishing": 350, finishing: 450, drilling: 90, tapping: 18, reaming: 120 },
    fz: { roughing: 0.05, "semi-finishing": 0.03, finishing: 0.015, drilling: 0.025, tapping: 1.0, reaming: 0.01 },
    notes: [
      "Harder and stronger than 6061 — reduce feeds 15%",
      "Excellent for aerospace and structural parts",
      "Built-up edge risk — keep tools sharp",
    ],
  },
  "steel-1045": {
    vc: { roughing: 80, "semi-finishing": 120, finishing: 160, drilling: 30, tapping: 8, reaming: 50 },
    fz: { roughing: 0.04, "semi-finishing": 0.025, finishing: 0.012, drilling: 0.02, tapping: 1.0, reaming: 0.008 },
    notes: [
      "TiAlN or AlCrN coated carbide recommended",
      "Flood coolant essential",
      "Pre-heat treat before finish machining if HRC > 30",
    ],
  },
  "steel-4140": {
    vc: { roughing: 60, "semi-finishing": 90, finishing: 120, drilling: 25, tapping: 6, reaming: 40 },
    fz: { roughing: 0.035, "semi-finishing": 0.02, finishing: 0.01, drilling: 0.018, tapping: 1.0, reaming: 0.007 },
    notes: [
      "Chromoly — machine in annealed state, then heat treat",
      "AlCrN coating preferred over TiN",
      "Reduce speeds 20% if material is pre-hardened",
    ],
  },
  "stainless-304": {
    vc: { roughing: 50, "semi-finishing": 80, finishing: 110, drilling: 20, tapping: 5, reaming: 35 },
    fz: { roughing: 0.03, "semi-finishing": 0.02, finishing: 0.01, drilling: 0.015, tapping: 1.0, reaming: 0.006 },
    notes: [
      "Work-hardens rapidly — maintain consistent chip load",
      "Flood coolant mandatory; avoid rubbing",
      "Use sharp tools; replace frequently",
      "TiAlN or PVD-coated submicron carbide",
    ],
  },
  "stainless-316": {
    vc: { roughing: 45, "semi-finishing": 70, finishing: 100, drilling: 18, tapping: 4, reaming: 30 },
    fz: { roughing: 0.028, "semi-finishing": 0.018, finishing: 0.009, drilling: 0.014, tapping: 1.0, reaming: 0.005 },
    notes: [
      "More difficult than 304 due to Mo content",
      "Higher tool pressure — rigid setup essential",
      "Check tool wear every 20 minutes",
    ],
  },
  "titanium-grade5": {
    vc: { roughing: 40, "semi-finishing": 60, finishing: 80, drilling: 15, tapping: 4, reaming: 25 },
    fz: { roughing: 0.025, "semi-finishing": 0.015, finishing: 0.008, drilling: 0.012, tapping: 1.0, reaming: 0.005 },
    notes: [
      "Low thermal conductivity — heat stays in tool",
      "High-pressure coolant (70+ bar) strongly recommended",
      "Use uncoated carbide (TiN reacts with titanium)",
      "Keep radial WOC ≤ 0.3 × D to control temperature",
      "Never stop tool in cut — retract first",
    ],
  },
  "brass-c360": {
    vc: { roughing: 400, "semi-finishing": 550, finishing: 700, drilling: 150, tapping: 30, reaming: 200 },
    fz: { roughing: 0.07, "semi-finishing": 0.05, finishing: 0.025, drilling: 0.04, tapping: 1.0, reaming: 0.012 },
    notes: [
      "Excellent machinability — highest chip load material",
      "Dry machining often acceptable",
      "Use straight flute drills for better chip evacuation",
    ],
  },
  "copper": {
    vc: { roughing: 200, "semi-finishing": 300, finishing: 400, drilling: 80, tapping: 15, reaming: 100 },
    fz: { roughing: 0.05, "semi-finishing": 0.035, finishing: 0.018, drilling: 0.025, tapping: 1.0, reaming: 0.01 },
    notes: [
      "Gummy — built-up edge risk",
      "Use high helix and sharp edges",
      "MQL or flood coolant",
    ],
  },
  "abs-plastic": {
    vc: { roughing: 500, "semi-finishing": 700, finishing: 900, drilling: 200, tapping: 50, reaming: 300 },
    fz: { roughing: 0.08, "semi-finishing": 0.06, finishing: 0.03, drilling: 0.05, tapping: 1.0, reaming: 0.015 },
    notes: [
      "Air cooling or light mist — no flood",
      "Sharp HSS or uncoated carbide",
      "Melting risk at high feeds — monitor",
    ],
  },
}

function defaultAP(d: number, op: string): number {
  if (op === "finishing" || op === "semi-finishing") return d * 0.05
  if (op === "drilling") return 0
  return d * 0.4
}

function defaultAE(d: number, op: string): number {
  if (op === "finishing") return d * 0.05
  if (op === "semi-finishing") return d * 0.2
  if (op === "drilling") return 0
  return d * 0.6
}

// ---------------------------------------------------------------------------

interface MaterialDBEntry {
  name: string
  designation: string
  category: string
  tensileStrength: number
  yieldStrength: number
  hardness: string
  density: number
  elasticModulus: number
  machinability: number
  vcRange: string
  coolant: string
  toolCoating: string
  treatments: string[]
  applications: string[]
}

const MATERIAL_DB: Record<string, MaterialDBEntry> = {
  "6061t6": {
    name: "Aluminum 6061-T6",
    designation: "AA 6061-T6 / AlSi1MgCu",
    category: "Aluminum alloy",
    tensileStrength: 310,
    yieldStrength: 276,
    hardness: "95 HB",
    density: 2.70,
    elasticModulus: 68.9,
    machinability: 90,
    vcRange: "300–500",
    coolant: "Flood or MQL",
    toolCoating: "Uncoated carbide or ZrN",
    treatments: ["Type II anodize (sulfuric)", "Type III hard anodize", "Chromate conversion (Alodine)", "Powder coat"],
    applications: ["Structural brackets", "Enclosures", "Fixtures", "Bicycle frames", "General machined parts"],
  },
  "7075t6": {
    name: "Aluminum 7075-T6",
    designation: "AA 7075-T6 / AlZnMgCu1.5",
    category: "Aluminum alloy",
    tensileStrength: 572,
    yieldStrength: 503,
    hardness: "150 HB",
    density: 2.81,
    elasticModulus: 71.7,
    machinability: 70,
    vcRange: "250–450",
    coolant: "Flood",
    toolCoating: "Uncoated carbide",
    treatments: ["Type II anodize", "Type III hard anodize", "Chromate conversion"],
    applications: ["Aerospace structures", "Gears", "High-stress mounts", "Fuse bodies"],
  },
  "1045": {
    name: "Carbon Steel 1045",
    designation: "AISI 1045 / C45 (DIN) / S45C (JIS)",
    category: "Carbon steel",
    tensileStrength: 620,
    yieldStrength: 415,
    hardness: "179 HB (annealed)",
    density: 7.85,
    elasticModulus: 200,
    machinability: 57,
    vcRange: "80–160",
    coolant: "Flood",
    toolCoating: "TiAlN",
    treatments: ["Through hardening (HRC 55–62)", "Induction hardening", "Zinc plating", "Black oxide", "Phosphate"],
    applications: ["Shafts", "Gears", "Pins", "Bolts", "General machined parts"],
  },
  "304": {
    name: "Stainless Steel 304",
    designation: "AISI 304 / 1.4301 / SUS304",
    category: "Austenitic stainless",
    tensileStrength: 515,
    yieldStrength: 205,
    hardness: "92 HRB",
    density: 8.00,
    elasticModulus: 193,
    machinability: 45,
    vcRange: "50–110",
    coolant: "Flood (mandatory)",
    toolCoating: "TiAlN or AlCrN",
    treatments: ["Passivation (HNO3)", "Electropolishing", "PVD coating"],
    applications: ["Food equipment", "Medical devices", "Marine hardware", "Chemical tanks"],
  },
  "316l": {
    name: "Stainless Steel 316L",
    designation: "AISI 316L / 1.4404 / SUS316L",
    category: "Austenitic stainless",
    tensileStrength: 485,
    yieldStrength: 170,
    hardness: "79 HRB",
    density: 7.99,
    elasticModulus: 193,
    machinability: 40,
    vcRange: "45–100",
    coolant: "Flood (mandatory)",
    toolCoating: "AlCrN or PVD submicron",
    treatments: ["Passivation", "Electropolishing", "Sterilization-compatible"],
    applications: ["Medical implants", "Pharmaceutical equipment", "Chemical processing", "Marine environments"],
  },
  "titaniumgrade5": {
    name: "Titanium Grade 5 (Ti-6Al-4V)",
    designation: "Ti-6Al-4V / Grade 5 / AMS 4928",
    category: "Titanium alloy",
    tensileStrength: 950,
    yieldStrength: 880,
    hardness: "36 HRC",
    density: 4.43,
    elasticModulus: 113.8,
    machinability: 22,
    vcRange: "40–80",
    coolant: "High-pressure flood (70+ bar)",
    toolCoating: "Uncoated carbide (TiN reacts with Ti)",
    treatments: ["Anodize (titanium)", "PVD coating", "Shot peening", "Passivation"],
    applications: ["Aerospace components", "Medical implants", "Racing parts", "High-strength connectors"],
  },
}

function findMaterial(query: string): MaterialDBEntry | undefined {
  const normalized = query.toLowerCase().replace(/[-\s]/g, "")
  for (const [key, val] of Object.entries(MATERIAL_DB)) {
    if (key === normalized || normalized.includes(key) || key.includes(normalized)) {
      return val
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------

interface GCodeIssue {
  line: number
  severity: "error" | "warning"
  message: string
  fix?: string
}

function validateGCode(gcode: string, controller: string): GCodeIssue[] {
  const lines = gcode.split("\n")
  const issues: GCodeIssue[] = []

  let hasG21 = false
  let hasG90 = false
  let hasSafetyBlock = false
  let spindleOn = false
  let coolantOn = false
  let toolLengthActive = false
  let inCannedCycle = false
  let cutterCompActive = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const ln = i + 1
    const line = raw.replace(/\(.*?\)/g, "").replace(/;.*$/, "").toUpperCase().trim()
    if (!line || line === "%" || line.startsWith("O")) continue

    if (line.includes("G21") || line.includes("G71")) hasG21 = true
    if (line.includes("G90")) hasG90 = true
    if (line.includes("G17") && line.includes("G40") && line.includes("G80")) hasSafetyBlock = true
    if (line.includes("M03") || line.includes("M04")) spindleOn = true
    if (line.includes("M05")) spindleOn = false
    if (line.includes("M08")) coolantOn = true
    if (line.includes("M09")) coolantOn = false
    if (line.includes("G43")) toolLengthActive = true
    if (line.includes("G49")) toolLengthActive = false
    if (/G8[1-9]/.test(line) || /G7[3-6]/.test(line)) inCannedCycle = true
    if (line.includes("G80")) inCannedCycle = false
    if (line.includes("G41") || line.includes("G42")) cutterCompActive = true
    if (line.includes("G40")) cutterCompActive = false

    // Check: G01 without spindle on
    if (/\bG01\b/.test(line) && !spindleOn) {
      issues.push({
        line: ln,
        severity: "error",
        message: "G01 (linear feed) called without spindle running",
        fix: "Add M03 S____ before first cut move",
      })
    }

    // Check: G01 without tool length offset (milling)
    if (/\bG01\b/.test(line) && !toolLengthActive && controller !== "heidenhain") {
      issues.push({
        line: ln,
        severity: "warning",
        message: "Cutting without active tool length offset (G43)",
        fix: "Add G43 H__ after tool change",
      })
    }

    // Check: rapids in canned cycle
    if (/\bG00\b/.test(line) && inCannedCycle) {
      issues.push({
        line: ln,
        severity: "warning",
        message: "G00 rapid inside canned cycle (may interrupt cycle)",
        fix: "Cancel canned cycle (G80) before rapid moves",
      })
    }

    // Check: coolant not on during cutting
    if (/\bG01\b/.test(line) && !coolantOn && spindleOn) {
      issues.push({
        line: ln,
        severity: "warning",
        message: "Cutting without coolant (M08)",
        fix: "Add M08 after spindle start, before cutting",
      })
    }

    // Check: M30 with coolant still on
    if (line.includes("M30") && coolantOn) {
      issues.push({
        line: ln,
        severity: "warning",
        message: "Program end (M30) with coolant still active",
        fix: "Add M09 before M30",
      })
    }

    // Check: M30 with spindle still on
    if (line.includes("M30") && spindleOn) {
      issues.push({
        line: ln,
        severity: "warning",
        message: "Program end (M30) with spindle still running",
        fix: "Add M05 before M30",
      })
    }
  }

  if (!hasG21) {
    issues.unshift({
      line: 1,
      severity: "warning",
      message: "No metric mode declaration found (G21)",
      fix: "Add G21 near start of program",
    })
  }

  if (!hasSafetyBlock) {
    issues.unshift({
      line: 1,
      severity: "warning",
      message: "Safety block not detected (G17 G40 G49 G80 G90)",
      fix: "Add safety block after O-number: N10 G17 G40 G49 G80 G90 G21",
    })
  }

  return issues
}

// ---------------------------------------------------------------------------

const TOOLPATH_ADVICE: Record<
  string,
  {
    primary: string
    alternative: string
    setup: string[]
    parameters: Array<{ name: string; value: string; note?: string }>
  }
> = {
  "open-pocket": {
    primary: "Adaptive / Trochoidal roughing + Z-level finishing",
    alternative: "Conventional pocket (raster) for simple shapes",
    setup: [
      "Start with adaptive roughing to leave uniform 0.3mm stock",
      "Semi-finish Z-levels with 0.1mm stock",
      "Finish in climb direction with fresh tool",
    ],
    parameters: [
      { name: "Stepover (rough)", value: "60–70% of tool D", note: "adaptive: 10–15% D" },
      { name: "Z-step (rough)", value: "40–50% of tool D" },
      { name: "Finish stepover", value: "5–10% of tool D" },
      { name: "Entry", value: "Helix, R = 30–40% of tool D" },
    ],
  },
  "closed-pocket": {
    primary: "Adaptive roughing (inside-out) + contour finishing",
    alternative: "Plunge roughing for deep narrow pockets",
    setup: [
      "Use helical entry to avoid plunge",
      "Machine inside-out for adaptive",
      "Use corner rounding on all internal radii",
    ],
    parameters: [
      { name: "Entry helix angle", value: "1–3°" },
      { name: "Corner feed reduction", value: "50% at R < tool radius" },
      { name: "Finish stock", value: "0.2mm XY, 0.1mm Z" },
    ],
  },
  "external-profile": {
    primary: "2D contour with cutter compensation (G41)",
    alternative: "Waterline if part is complex",
    setup: [
      "Approach tangentially (arc entry) to avoid witness mark",
      "Leave 0.2mm for finishing pass",
      "Full depth finishing pass for best surface",
    ],
    parameters: [
      { name: "Entry arc", value: "R = tool radius min" },
      { name: "Overlap", value: "5mm past start point" },
      { name: "Climb", value: "Yes (G41 with M03)" },
    ],
  },
  bore: {
    primary: "Single-point boring bar for tolerance < ±0.02mm",
    alternative: "Interpolated circular milling for larger bores",
    setup: [
      "Pre-drill close to bore diameter",
      "Use rigid boring bar with minimum overhang",
      "Dwell 0.3s before retract to spring-back",
    ],
    parameters: [
      { name: "Bore speed", value: "50–70% of drilling speed" },
      { name: "Feed", value: "0.05–0.1mm/rev" },
      { name: "Stock for bore", value: "0.2–0.5mm on diameter" },
      { name: "Cycle", value: "G76 fine boring (Fanuc)" },
    ],
  },
  face: {
    primary: "Face mill with 45° lead angle",
    alternative: "Shell endmill for smaller areas",
    setup: [
      "Lead angle (45°) reduces cutting forces and tool shock",
      "Step 70–80% of cutter diameter",
      "Final pass: 0.2mm depth, full width",
    ],
    parameters: [
      { name: "Stepover", value: "70% of insert cutting diameter" },
      { name: "Lead angle", value: "45° (reduces vibration)" },
      { name: "Final depth", value: "0.2mm" },
    ],
  },
  "complex-surface": {
    primary: "3D parallel (Z-level) roughing + contour-parallel or flow-line finishing",
    alternative: "Scallop-based finishing for uniform Ra",
    setup: [
      "Rough with large endmill, leave 0.5mm uniform stock",
      "Semi-finish Z-level 0.1mm stock",
      "Finish with ball-nose perpendicular to main curvature",
    ],
    parameters: [
      { name: "Roughing stepover", value: "50% of tool D" },
      { name: "Finishing stepover", value: "0.1–0.2mm (Ra 1.6μm target)" },
      { name: "Tool for finish", value: "Ball-nose R3 min" },
    ],
  },
  "5-axis-port": {
    primary: "5-axis swarf (flank) milling for cylindrical surfaces",
    alternative: "5-axis point milling with short ball-nose",
    setup: [
      "Define drive surface and check axis travel limits",
      "Enable smooth tool axis interpolation",
      "Simulate full machine kinematics before posting",
    ],
    parameters: [
      { name: "Lead angle", value: "5° forward tilt" },
      { name: "Tilt angle", value: "15° from surface normal" },
      { name: "Smooth axis", value: "Bezier / cubic interpolation" },
    ],
  },
  "thread-mill": {
    primary: "Thread milling (single-point or multi-thread insert)",
    alternative: "Rigid tapping (G84) for M2–M20",
    setup: [
      "Pre-drill to 80% of thread major diameter",
      "Thread mill: one helical pass = one thread",
      "Always climb mill threads",
    ],
    parameters: [
      { name: "Pre-drill", value: "Tap drill size per ISO 965" },
      { name: "Helix pitch", value: "= thread pitch per rev" },
      { name: "Direction", value: "Climb (G41 + G03 for internal right-hand)" },
    ],
  },
  "deep-slot": {
    primary: "Trochoidal (dynamic) milling with reduced WOC",
    alternative: "Plunge milling if slot depth > 6× width",
    setup: [
      "Trochoidal: WOC = 15% of D, full depth per pass",
      "Excellent chip evacuation — use compressed air",
      "Long flute extended reach endmill if required",
    ],
    parameters: [
      { name: "WOC (trochoidal)", value: "15% of tool D" },
      { name: "Depth/pass", value: "Up to 3× tool D" },
      { name: "Arc radius", value: "15–20% of slot width" },
    ],
  },
}

const CAM_STRATEGY_NAMES: Record<string, Record<string, string>> = {
  hypermill: {
    "open-pocket": "2.5D Pocket Milling / 3D Z-Level Shape Roughing",
    "closed-pocket": "2.5D Pocket Milling",
    "external-profile": "2.5D Profile Milling",
    bore: "2.5D Drilling (G76 cycle)",
    face: "2.5D Face Milling",
    "complex-surface": "3D Z-Level Shape Roughing → 3D Contour-Parallel Finishing",
    "5-axis-port": "5-Axis Flow Line Machining / 5-Axis Swarf Milling",
    "thread-mill": "2.5D Thread Milling",
    "deep-slot": "2.5D Pocket Milling (trochoidal)",
  },
  fusion360: {
    "open-pocket": "Adaptive Clearing → Contour",
    "closed-pocket": "Adaptive Clearing → Contour",
    "external-profile": "2D Contour",
    bore: "Bore",
    face: "Face",
    "complex-surface": "Adaptive 3D → Scallop or Parallel",
    "5-axis-port": "5-Axis Swarf",
    "thread-mill": "Thread",
    "deep-slot": "Slot / 2D Adaptive",
  },
  mastercam: {
    "open-pocket": "Dynamic Mill → Contour",
    "closed-pocket": "Dynamic Mill",
    "external-profile": "Contour (2D)",
    bore: "Circle Mill / Bore",
    face: "Face",
    "complex-surface": "Optirough → Scallop",
    "5-axis-port": "Multiaxis / Swarf",
    "thread-mill": "Thread Mill",
    "deep-slot": "Dynamic Mill",
  },
}
