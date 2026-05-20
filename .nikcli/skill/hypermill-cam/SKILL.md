---
name: hypermill-cam
description: Program CNC toolpaths using OPEN MIND HyperMILL CAM software. Use this skill for 2.5D, 3D, and 5-axis milling strategies, tool management, postprocessing, and NC code generation in HyperMILL.
category: metalworking
tags:
  - hypermill
  - cam
  - cnc
  - 5-axis
  - milling
  - open-mind
version: 1.0.0
---

# HyperMILL CAM

OPEN MIND HyperMILL is a high-end CAM system for 2.5D through 5-axis simultaneous machining. It integrates into SolidWorks and Inventor as an embedded plugin, and runs standalone with its own geometry kernel.

## Workflow overview

```
CAD model (STEP/SolidWorks) → HyperMILL Job List → Strategy → Tool → Feeds/Speeds → Verify → Post → NC file
```

## Project setup

1. Open HyperMILL Job List from the HyperMILL tab
2. **New Job** → Set machine, postprocessor, NC output path
3. Define **zero point** (WCS origin) on model
4. Add **raw part** (stock) — block, cylinder, or imported STL

```
Machine:       Hermle C 400 (5-axis)
Postprocessor: heidenhain_tnc640.hps
NC output:     C:\NC\PART001\
Unit:          Millimeter
```

## Tool library

Tools are managed in the HyperMILL Tool Database (`.hdb` file).

### Recommended tool definitions for steel

```
Roughing endmill:
  Type: Cylindrical endmill
  Diameter: 12mm
  Flutes: 4
  Material: Carbide (TiAlN coating)
  Overhang: 35mm max
  
Finishing endmill:
  Type: Ball-nose endmill
  Diameter: 6mm
  Flutes: 4
  Material: Carbide (AlCrN coating)
  Corner radius: 3mm (= R3 full ball)
  
Drill:
  Type: Twist drill
  Diameter: 5.0mm (for M6 tap)
  Point angle: 118°
  Coating: TiN
```

## 2.5D strategies

### Face milling

```
Strategy: 2.5D Face Milling
Parameters:
  Step-over: 70% of tool diameter
  Allowance (XY): 0.0mm (finish)
  Allowance (Z):  0.0mm
  Entry: Plunge / Ramp
  Coolant: Flood
```

### Profile milling (contour)

```
Strategy: 2.5D Profile Milling
Parameters:
  Contour type: Outer profile
  Climb/Conventional: Climb
  Multiple depth: Z-step = 3mm per pass
  Finishing pass: 0.1mm stock → 0mm final
  Entry arc: R = tool radius
```

### Pocket milling

```
Strategy: 2.5D Pocket Milling
Parameters:
  Clearance offset: 0.2mm
  Spiral inward: Yes (for closed pockets)
  Z-step roughing: 4mm
  Finish stock: 0.2mm XY, 0.1mm Z
  Linking: Helix entry, R = 40% of tool D
```

### Drilling / boring

```
Strategy: 2.5D Drilling
  Cycle: G81 (through), G83 (deep/peck), G76 (boring)
  Peck depth: 2× tool diameter for deep holes
  Dwell: 0.3s for blind holes
  
For M6 tap prep:
  Drill ⌀5.0mm
  Chamfer ⌀6.5mm × 90°
  Tap M6×1.0 (rigid tapping G84)
```

## 3D strategies

### Z-level finishing (waterline)

```
Strategy: 3D Z-Level Shape Finishing
Tool: Ball-nose R3
Parameters:
  Step-down (Z): 0.15mm (Ra target ≤ 1.6μm)
  Machining direction: Climb
  Angle limit: 0–89° (flat areas → use flat finishing)
  Overlap: 0.5mm into adjacent surfaces
```

### Rest machining

```
Strategy: 3D Rest Material Removal
Reference tool: ⌀12mm endmill (previous op)
Tool: ⌀6mm ball-nose R3
Stepdown: 0.1mm
Purpose: Remove material left in corners
```

### Contour parallel finishing

```
Strategy: 3D Contour-Parallel Finishing
Tool: Ball-nose R3
Step-over: 0.15mm (for Ra ≤ 1.6μm aluminum)
Machining angle: Follow surface normals
```

## 5-axis strategies

### 5-axis profile milling

```
Strategy: 5-Axis Profile Milling
Tool axis control: Side tilt 15° from normal
Lead angle: 5° (forward tilt)
Collision check: ON (model + holder)
```

### 5-axis flow line machining

```
Strategy: 5-Axis Flow Line Machining
Tool: Ball-nose R3
Step-over: 0.12mm
Drive surfaces: Select curved surfaces
Smooth tool axis: Bezier interpolation
```

### 5-axis drilling (indexed)

```
Strategy: 5-Axis Drilling
Rotation: A+C or B+C depending on machine
Approach: Normal to hole axis
Clearance: 5mm above hole entry
```

## Feeds and speeds reference

### Aluminum 6061 (dry/MQL)

| Operation | Tool ⌀ | RPM | Feed (mm/min) | DOC (mm) | WOC (mm) |
|-----------|--------|-----|----------------|----------|----------|
| Roughing | 12mm | 8000 | 2400 | 5 | 8 |
| Finishing | 6mm | 12000 | 1200 | 0.3 | 3 |
| Drilling | 5mm | 3000 | 180 | — | — |

### Steel 1045 (flood coolant)

| Operation | Tool ⌀ | RPM | Feed (mm/min) | DOC (mm) | WOC (mm) |
|-----------|--------|-----|----------------|----------|----------|
| Roughing | 12mm | 3500 | 700 | 3 | 6 |
| Finishing | 6mm | 6000 | 600 | 0.2 | 2 |
| Drilling | 5mm | 1200 | 80 | — | — |

## Postprocessor and NC output

HyperMILL ships with `.hps` postprocessors. Common machines:

| Machine controller | Postprocessor file |
|--------------------|--------------------|
| Heidenhain TNC 640 | `heidenhain_tnc640.hps` |
| Siemens Sinumerik 840D | `sinumerik840d.hps` |
| Fanuc 0i-MF | `fanuc_0i.hps` |
| DMG DMU (Heidenhain) | `dmg_dmu_tnc640.hps` |

Generate NC: Right-click Job → **Generate NC code** → NC files land in output folder.

## Simulation and verification

Before sending to machine:
1. **HyperMILL VIRTUAL Machining** — full machine simulation with kinematic model
2. Check: Collisions, over-travel, spindle interference
3. **Stock compare** — verify remaining material matches intent

## Checklist

- Always define **zero point** before creating operations
- Use **rest machining** to avoid re-cutting with large tools
- Set **approach/retract** arcs to avoid entry marks
- Verify tool stick-out vs. required reach (avoid long overhangs)
- Enable **holder collision check** with actual holder library
- Review feed rates at corners (feed reduction: 50% at R < tool radius)
