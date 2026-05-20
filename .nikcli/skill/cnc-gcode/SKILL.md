---
name: cnc-gcode
description: Write, read, and validate G-code for CNC milling, turning, and EDM machines. Use this skill to generate toolpaths, understand G/M codes, optimize cutting parameters, and post-process NC programs for specific controllers (Fanuc, Heidenhain, Siemens).
category: metalworking
tags:
  - cnc
  - gcode
  - milling
  - turning
  - fanuc
  - heidenhain
  - siemens
version: 1.0.0
---

# CNC G-Code

G-code (ISO 6983) is the standard language for CNC machines. This skill covers writing, validating, and optimizing NC programs for milling, turning, and related operations.

## File structure

```gcode
%                          ; Program start (Fanuc/HAAS)
O0001                      ; Program number (Fanuc)
(PART: Bracket v3)         ; Comment
(MATERIAL: 6061-T6)
(DATE: 2024-01-15)
N10 G21                    ; Metric mode
N20 G17 G40 G49 G80 G90   ; Safety line: XY plane, cancel comp/length/cycles, absolute
N30 G28 Z0.               ; Reference Z return
N40 T01 M06               ; Tool change: Tool 1
N50 G43 H01 Z100.         ; Tool length offset

; First operation
N60  S8000 M03            ; Spindle 8000 RPM, CW
N70  M08                  ; Coolant on
N80  G00 X0. Y0.          ; Rapid to start
N90  G00 Z5.              ; Rapid to clearance
N100 G01 Z-5. F200.       ; Feed to depth
N110 G01 X60. F2400.      ; Cut

N200 G00 Z100.            ; Retract
N210 M09                  ; Coolant off
N220 M05                  ; Spindle off
N230 G28 Z0. M30          ; Home Z, program end
%
```

## Essential G-codes

### Motion

| Code | Description |
|------|-------------|
| `G00` | Rapid positioning (no cut) |
| `G01` | Linear feed (cutting) |
| `G02` | Circular CW |
| `G03` | Circular CCW |
| `G04 P500` | Dwell 500ms |

### Coordinate systems

| Code | Description |
|------|-------------|
| `G90` | Absolute positioning |
| `G91` | Incremental positioning |
| `G54`–`G59` | Work offsets (WCS) |
| `G92` | Set current position as origin (avoid; use G54) |

### Canned cycles (Fanuc)

| Code | Description |
|------|-------------|
| `G81` | Drilling cycle |
| `G83` | Deep hole peck drilling |
| `G84` | Tapping (rigid) |
| `G85` | Boring (feed in, feed out) |
| `G76` | Fine boring |
| `G80` | Cancel canned cycle |

```gcode
; Peck drill 5mm ⌀, 30mm deep, peck 5mm
G83 X10. Y10. Z-30. R5. Q5. F80.
G83 X30. Y10.           ; repeat at new position
G80                     ; cancel
```

### Tool compensation

| Code | Description |
|------|-------------|
| `G41` | Cutter comp left (climb milling typical) |
| `G42` | Cutter comp right |
| `G40` | Cancel cutter comp |
| `G43 H__` | Tool length comp (+) |
| `G49` | Cancel length comp |

```gcode
; Profile with cutter compensation (6mm endmill, Ø offset in register)
G41 D01 G01 X10. Y10. F1200.   ; enable left comp, D01 = radius register
G01 X60.
G01 Y50.
G01 X10.
G01 Y10.
G40 G01 X0. Y0.                ; cancel comp
```

## Circular interpolation

```gcode
; G02/G03: X Y = endpoint, I J = center offset from start
; Arc from (10,0) to (0,10) CCW, center at (0,0)
G03 X0. Y10. I-10. J0. F600.

; Alternative: using R (radius) — simpler but can be ambiguous >180°
G03 X0. Y10. R10. F600.
```

## Subprograms (subroutines)

```gcode
; Fanuc M98/M99 subroutine
M98 P0010 L4          ; Call O0010 four times

O0010                 ; Subroutine
G91 G01 Z-5. F200.    ; Peck 5mm incremental
G90
M99                   ; Return
```

## Heidenhain TNC conversational format

```
BEGIN PGM BRACKET MM
BLK FORM 0.1 Z X+0 Y+0 Z-30         ; Stock definition (min corner)
BLK FORM 0.2   X+120 Y+80 Z+0       ; Stock (max corner)
TOOL CALL 1 Z S8000                  ; Call tool 1, Z-axis, 8000 RPM
L Z+100 FMAX                        ; Rapid to Z100
L X+0 Y+0 FMAX                     ; Rapid to start
L Z+5 FMAX
L Z-5 F200                         ; Feed to depth
L X+60 F2400                       ; Cut
L Z+100 FMAX
M30                                 ; Program end
END PGM BRACKET MM
```

## Siemens Sinumerik 840D

```gcode
%_N_BRACKET_MPF
;$PATH=/_N_MPF_DIR
G71                          ; Metric
G90 G17                      ; Absolute, XY plane
T1 D1 M6                     ; Tool 1, offset 1
G96 S200 LIMS=5000 M3        ; Constant surface speed 200m/min, max 5000 RPM
M8
G0 X0 Y0
G0 Z5
G1 Z-5 F200
G1 X60 F2400
G0 Z100
M30
```

## Feed and speed calculator

For **aluminum 6061**, carbide endmill:
```
Vc (cutting speed) = 300 m/min
Tool diameter D = 10mm

RPM = (Vc × 1000) / (π × D) = (300 × 1000) / (3.14159 × 10) = 9549 RPM
→ Use S9500

Chip load per tooth fz = 0.05mm (4-flute finishing)
Feed = RPM × flutes × fz = 9500 × 4 × 0.05 = 1900 mm/min
→ Use F1900
```

For **steel 1045**:
```
Vc = 80 m/min
RPM = (80 × 1000) / (π × 10) = 2546 → S2500
fz = 0.03mm
Feed = 2500 × 4 × 0.03 = 300 mm/min → F300
```

## G-code validation checklist

```
✓ Safety block at start: G17 G40 G49 G80 G90 G21
✓ Tool length offset active (G43 H__) before cutting
✓ Work offset set (G54 or equivalent)
✓ Spindle started (M03/M04) before G01
✓ Coolant on (M08) after spindle up
✓ Cancel canned cycles (G80) when done
✓ Retract to safe Z before tool change
✓ Cancel cutter comp (G40) on last move
✓ Coolant off (M09) before M30
✓ Spindle off (M05) before M30
```

## Common mistakes

| Problem | Cause | Fix |
|---------|-------|-----|
| Tool crashes on first move | Missing `Z` retract before rapid | Add `G00 Z100.` after tool change |
| Wrong depth | G90/G91 mix | Always reset to `G90` after incremental ops |
| Spiral plunge | Helix not in program | Add `G02/G03` helix entry |
| Chatter | Too much radial WOC | Reduce to ≤ 0.5 × tool diameter |
| Rough finish | Wrong direction | Use climb milling (G41 with CW spindle) |

## Useful macros (JavaScript/Node)

```typescript
function gcode(opts: {
  x?: number; y?: number; z?: number;
  f?: number; s?: number;
  code?: string;
}): string {
  const parts: string[] = [opts.code ?? "G01"]
  if (opts.x !== undefined) parts.push(`X${opts.x.toFixed(3)}`)
  if (opts.y !== undefined) parts.push(`Y${opts.y.toFixed(3)}`)
  if (opts.z !== undefined) parts.push(`Z${opts.z.toFixed(3)}`)
  if (opts.f !== undefined) parts.push(`F${opts.f.toFixed(0)}`)
  if (opts.s !== undefined) parts.push(`S${opts.s.toFixed(0)}`)
  return parts.join(" ")
}

// Generate a rectangular pocket toolpath
function rectPocket(x: number, y: number, w: number, h: number, depth: number, tool_d: number, f: number) {
  const lines: string[] = []
  const stepover = tool_d * 0.5
  let x0 = x + tool_d / 2
  let y0 = y + tool_d / 2
  const x1 = x + w - tool_d / 2
  const y1 = y + h - tool_d / 2
  
  lines.push(`G00 X${x0.toFixed(3)} Y${y0.toFixed(3)}`)
  lines.push(`G01 Z${(-depth).toFixed(3)} F${(f * 0.3).toFixed(0)}`)
  
  let cur_x = x0
  while (cur_x <= x1) {
    lines.push(gcode({ x: cur_x, y: y1, f }))
    lines.push(gcode({ x: Math.min(cur_x + stepover, x1), y: y1, f }))
    cur_x += stepover
    lines.push(gcode({ x: cur_x, y: y0, f }))
    lines.push(gcode({ x: Math.min(cur_x + stepover, x1), y: y0, f }))
    cur_x += stepover
  }
  lines.push("G00 Z5.000")
  return lines.join("\n")
}
```
