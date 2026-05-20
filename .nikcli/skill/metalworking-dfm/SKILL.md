---
name: metalworking-dfm
description: Apply Design for Manufacturing (DFM) principles to metal parts. Use this skill to review designs for machinability, sheet metal fabrication, casting, and welding — identifying features that are expensive or impossible to manufacture and suggesting alternatives.
category: metalworking
tags:
  - dfm
  - design
  - machining
  - sheet-metal
  - casting
  - welding
  - tolerances
version: 1.0.0
---

# Metalworking Design for Manufacturing (DFM)

Review and optimize metal part designs for manufacturability. Each manufacturing process has specific design rules — this skill helps identify issues early before they become expensive.

## CNC Machining DFM

### Internal corners
```
❌ Sharp internal corners (r = 0)
   → Requires EDM or special tooling
   
✓ Minimum inside corner radius ≥ tool radius + 10% clearance
   → For 6mm endmill: R ≥ 3.3mm (use R4mm standard)
   → Document in drawing: "Inside radii R4 typ unless noted"
```

### Cavity depth-to-width ratio
```
❌ Pockets deeper than 4× their narrowest width
   → Tool deflection, chatter, poor finish

✓ Depth:Width ≤ 4:1 for standard tooling
✓ Up to 6:1 with extended flute endmills (slower feeds)
✓ For deeper: redesign as a separate part or use EDM
```

### Thin walls
```
Material-dependent minimum wall thickness (milled):
  Aluminum:       ≥ 0.8mm (rigid: 1.5mm)
  Steel/SS:       ≥ 1.5mm (rigid: 2.5mm)
  Titanium:       ≥ 2.0mm (rigid: 3.0mm)
  
✓ Add fillets at wall base to reduce stress concentration
✓ Support thin features with gussets if possible
```

### Undercuts
```
❌ Undercuts not accessible from any setup
   → Impossible without special tooling or multiple setups

✓ Redesign to eliminate undercut
✓ Or: split part at undercut into two pieces + join
✓ Or: use T-slot cutter (limited depths)
```

### Hole design
```
Through holes:
  ✓ Preferred: L/D ≤ 5 (standard)
  ✓ Acceptable: L/D ≤ 10 with peck drilling
  ❌ Avoid: L/D > 10 without gun drilling

Blind holes:
  ✓ Add ≥ 1mm flat at bottom (twist drill geometry)
  ✓ Use "⌀6 × 20↓ 18 deep thread" notation
  ❌ Do not thread to bottom of blind hole (leave 1.5P relief)

Minimum hole diameter:
  Aluminum: ≥ 1.0mm
  Steel:    ≥ 1.5mm
  
Hole placement:
  ✓ Minimum edge distance: 1.5× diameter from edge
  ✓ Minimum hole-to-hole spacing: 1× diameter between walls
```

### Tolerances (ISO fits)

| Fit type | Typical IT grade | Application |
|----------|-----------------|-------------|
| Running/sliding | H7/f7, H7/g6 | Shafts, bushings |
| Locating clearance | H7/h6 | Bearings, pins |
| Transition | H7/k6, H7/m6 | Press fit (light) |
| Interference | H7/p6, H7/r6 | Press fit (permanent) |

```
Standard tolerance for unmachined surfaces: ±0.5mm
Standard machined: ±0.1mm (ISO IT10)
Fine machined: ±0.025mm (ISO IT8)
Ground: ±0.005mm (ISO IT6)

Cost increases ~2× per IT grade tighter
```

## Sheet Metal DFM

### Bend radius
```
Minimum inside bend radius:
  Aluminum 5052-H32: 0.8× thickness (t)
  Steel cold-rolled:  1.0× t
  Stainless 304:      1.5× t
  
  ✓ Use: R = 1× t as default
  ❌ Avoid: R < 0.5× t (cracking risk)
```

### Bend relief
```
✓ Relief cuts at all bend terminations near edges
  Relief width ≥ t
  Relief depth ≥ t + bend radius
  
✓ Minimum flange length = 4× t (for standard press brake)
```

### Hole proximity to bends
```
✓ Minimum hole distance from bend: 2× t + R
  Example: 2mm steel, R2 → distance ≥ 6mm
  
❌ Holes closer than this will deform during bending
✓ Move hole or add after bending (secondary operation)
```

### Weld flanges
```
✓ Include weld access clearance ≥ 25mm for MIG gun
✓ Welding distortion allowance: 0.5–1mm per 100mm of weld bead
✓ Use back-step welding sequence to minimize distortion
```

## Casting DFM

### Draft angles
```
Minimum draft per face:
  Sand casting:       1–3°
  Die casting:        0.5–2° (less with EDM cavities)
  Investment casting: 0–1° (near zero possible)
  
Apply draft in direction of mold pull
```

### Wall thickness uniformity
```
✓ Maintain uniform wall thickness ±25%
❌ Abrupt thickness changes → porosity, cold shuts

Minimum wall:
  Aluminum die cast: 2.0mm
  Zinc die cast:     0.8mm
  Iron sand cast:    5.0mm
```

### Parting line
```
✓ Place parting line at part midplane when possible
✓ Avoid parting line across critical sealing surfaces
✓ Add 0.5mm parting line mismatch allowance on drawings
```

## GD&T quick reference

| Symbol | Name | Used for |
|--------|------|----------|
| ⊙ | Position | Hole patterns relative to datums |
| // | Parallelism | Mating faces |
| ⊥ | Perpendicularity | Walls, bore axes |
| ○ | Circularity | Turned diameters |
| ⌭ | Cylindricity | Bore precision |
| — | Flatness | Sealing faces, mounting surfaces |
| ⌒ | Profile of a surface | Complex 3D surfaces |

```
Datum selection priority:
  A = primary (largest stable face, 3 points)
  B = secondary (long edge, 2 points)
  C = tertiary (short edge/hole, 1 point)
```

## Material selection guide

| Material | Machinability | Strength | Corrosion | Use case |
|----------|--------------|----------|-----------|----------|
| Al 6061-T6 | Excellent | Good | Good | Structural, anodized |
| Al 7075-T6 | Good | Excellent | Moderate | Aerospace, high-stress |
| Steel 1045 | Good | Good | Poor | General machined parts |
| SS 304 | Poor | Good | Excellent | Food, marine |
| SS 316L | Poor | Good | Excellent | Chemical, medical |
| Ti Grade 5 | Difficult | Excellent | Excellent | Aerospace, medical |
| Brass C360 | Excellent | Moderate | Good | Electrical, decorative |

## DFM review checklist

```
Machining:
  □ All features accessible from ≤ 4 setups
  □ Internal corner radii ≥ 30% of tool diameter
  □ No depth-to-width ratio > 4:1 in pockets
  □ Wall thickness above minimum for material
  □ Thread callouts complete (M6×1.0-6H typ.)
  □ Critical tolerances justified and inspectable
  □ Surface finish specified where required (Ra 1.6 typical)
  □ GD&T datums defined for inspection

Sheet metal:
  □ Bend radii ≥ 1× material thickness
  □ Bend relief on all slots/cutouts at bends
  □ Flange lengths ≥ 4× thickness
  □ No holes closer than 2t+R from bends

General:
  □ Part orientation and fixturing is obvious
  □ No features requiring EDM without justification
  □ Material and heat treatment specified
  □ Finish/plating specified with masking callouts
  □ Similar-looking assemblies mistake-proofed (poka-yoke)
```
