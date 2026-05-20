---
name: cad-formats
description: Work with CAD file formats — STEP, IGES, STL, DXF, GLTF, OBJ. Use this skill to convert between formats, inspect geometry, repair meshes, and understand which format to use for different workflows (CAM, simulation, 3D printing, rendering).
category: metalworking
tags:
  - cad
  - step
  - iges
  - stl
  - dxf
  - file-formats
  - conversion
version: 1.0.0
---

# CAD File Formats

Understanding and converting between CAD formats is critical in metalworking pipelines. This skill covers the most common formats, their strengths, and conversion tools.

## Format comparison

| Format | Ext | Type | Parametric | Use case |
|--------|-----|------|-----------|----------|
| STEP | .step .stp | B-rep solid | Partial | Universal exchange, CAM input |
| IGES | .igs .iges | Surfaces/solids | No | Legacy exchange |
| STL | .stl | Triangle mesh | No | 3D printing, simulation |
| DXF | .dxf | 2D/3D curves | No | Laser cut, plasma, waterjet |
| GLTF/GLB | .gltf .glb | Mesh | No | Web/AR visualization |
| OBJ | .obj | Mesh | No | Rendering, basic mesh |
| 3MF | .3mf | Mesh + metadata | No | Modern 3D printing |
| AMF | .amf | Mesh + color | No | Multi-material printing |
| Parasolid | .x_t .x_b | B-rep | Yes | SolidWorks, NX native |
| ACIS | .sat .sab | B-rep | Yes | AutoCAD, Fusion native |
| JT | .jt | Multi-LOD | Partial | PLM visualization |

## STEP (ISO 10303)

The de-facto standard for solid model exchange. Prefer over IGES for any new workflow.

**Versions**: AP203 (geometric only), AP214 (includes color/layers), AP242 (modern, includes PMI/GD&T)

### Read STEP with Python (Open CASCADE via pythonOCC)

```python
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.BRep import BRep_Builder
from OCC.Core.TopoDS import TopoDS_Compound
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh

def load_step(path: str):
    reader = STEPControl_Reader()
    status = reader.ReadFile(path)
    if status != IFSelect_RetDone:
        raise RuntimeError(f"Failed to read STEP: {path}")
    reader.TransferRoots()
    shape = reader.OneShape()
    return shape

shape = load_step("part.step")
```

### Write STEP

```python
from OCC.Core.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCC.Core.Interface import Interface_Static

def save_step(shape, path: str, ap=214):
    writer = STEPControl_Writer()
    Interface_Static.SetCVal("write.step.schema", f"AP{ap}")
    writer.Transfer(shape, STEPControl_AsIs)
    writer.Write(path)

save_step(shape, "output.step", ap=242)
```

### Inspect STEP properties

```python
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop

props = GProp_GProps()
brepgprop.VolumeProperties(shape, props)
volume_mm3 = props.Mass() * 1e9  # if STEP is in meters

brepgprop.SurfaceProperties(shape, props)
surface_mm2 = props.Mass() * 1e6

print(f"Volume: {volume_mm3:.2f} mm³")
print(f"Surface area: {surface_mm2:.2f} mm²")

# Bounding box
from OCC.Core.Bnd import Bnd_Box
from OCC.Core.BRepBndLib import brepbndlib
box = Bnd_Box()
brepbndlib.Add(shape, box)
xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
print(f"Dimensions: {(xmax-xmin)*1000:.2f} × {(ymax-ymin)*1000:.2f} × {(zmax-zmin)*1000:.2f} mm")
```

## STL

Triangle mesh format. Two variants: ASCII (human-readable, large) and binary (compact).

### Write STL from STEP (pythonOCC)

```python
from OCC.Core.StlAPI import StlAPI_Writer
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh

def step_to_stl(step_path: str, stl_path: str, linear_deflection=0.01, angular_deflection=0.5):
    shape = load_step(step_path)
    # Mesh the shape
    mesh = BRepMesh_IncrementalMesh(shape, linear_deflection, False, angular_deflection, True)
    mesh.Perform()
    
    writer = StlAPI_Writer()
    writer.SetASCIIMode(False)  # binary
    writer.Write(shape, stl_path)
```

### Read/write binary STL (Node.js)

```typescript
import fs from "fs"

interface Triangle {
  normal: [number, number, number]
  vertices: [[number, number, number], [number, number, number], [number, number, number]]
}

function readBinarySTL(path: string): Triangle[] {
  const buf = fs.readFileSync(path)
  const count = buf.readUInt32LE(80)
  const triangles: Triangle[] = []
  for (let i = 0; i < count; i++) {
    const offset = 84 + i * 50
    const normal: [number, number, number] = [
      buf.readFloatLE(offset), buf.readFloatLE(offset + 4), buf.readFloatLE(offset + 8)
    ]
    const vertices: [[number, number, number], [number, number, number], [number, number, number]] = [
      [buf.readFloatLE(offset + 12), buf.readFloatLE(offset + 16), buf.readFloatLE(offset + 20)],
      [buf.readFloatLE(offset + 24), buf.readFloatLE(offset + 28), buf.readFloatLE(offset + 32)],
      [buf.readFloatLE(offset + 36), buf.readFloatLE(offset + 40), buf.readFloatLE(offset + 44)],
    ]
    triangles.push({ normal, vertices })
  }
  return triangles
}
```

### STL mesh repair (Python + trimesh)

```python
import trimesh

mesh = trimesh.load("model.stl")

# Check validity
print("Watertight:", mesh.is_watertight)
print("Volume:", mesh.volume, "mm³")

# Auto-repair
trimesh.repair.fix_winding(mesh)
trimesh.repair.fix_normals(mesh)
trimesh.repair.fill_holes(mesh)

# Simplify (decimate)
simplified = mesh.simplify_quadric_decimation(face_count=5000)
simplified.export("model_repaired.stl")
```

## DXF

2D vector format for flat-pattern fabrication (laser, plasma, waterjet, punching).

### Write DXF with Python (ezdxf)

```python
import ezdxf
from ezdxf.enums import TextEntityAlignment

def create_laser_cut_dxf(
    width: float, height: float,
    holes: list[tuple[float, float, float]],  # (x, y, diameter)
    output: str
):
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    
    # Outer profile on "CUT" layer
    doc.layers.add("CUT", color=7)  # white/black
    msp.add_lwpolyline(
        [(0, 0), (width, 0), (width, height), (0, height)],
        close=True, dxfattribs={"layer": "CUT"}
    )
    
    # Holes
    doc.layers.add("HOLES", color=5)  # blue
    for x, y, d in holes:
        msp.add_circle((x, y), d / 2, dxfattribs={"layer": "HOLES"})
    
    # Dimensions
    doc.layers.add("DIM", color=3)  # green
    msp.add_linear_dim(base=(0, -10), p1=(0, 0), p2=(width, 0), dxfattribs={"layer": "DIM"}).render()
    
    doc.saveas(output)

create_laser_cut_dxf(100, 60, [(10, 10, 6), (90, 10, 6), (10, 50, 6), (90, 50, 6)], "plate.dxf")
```

### Read DXF entities

```python
import ezdxf

doc = ezdxf.readfile("plate.dxf")
msp = doc.modelspace()

for entity in msp:
    print(entity.dxftype(), entity.dxf.layer)
    if entity.dxftype() == "CIRCLE":
        print(f"  center={entity.dxf.center}, r={entity.dxf.radius}")
    elif entity.dxftype() == "LINE":
        print(f"  start={entity.dxf.start}, end={entity.dxf.end}")
```

## GLTF (for web visualization)

```python
import trimesh

# Load STEP, export as GLB (binary GLTF)
mesh = trimesh.load("part.step")
mesh.export("part.glb")

# With PBR material (metallic steel look)
material = trimesh.visual.material.PBRMaterial(
    baseColorFactor=[0.7, 0.7, 0.75, 1.0],
    metallicFactor=0.9,
    roughnessFactor=0.3,
)
mesh.visual.material = material
mesh.export("part_steel.glb")
```

## Conversion pipeline cheatsheet

```
Text prompt → Zoo.dev API → STEP  (text-to-cad skill)
STEP        → STL               (pythonOCC or FreeCAD)
STEP        → DXF (flat)        (SolidWorks SaveAs / FreeCAD TechDraw)
STEP        → GLTF              (trimesh.load + .export)
SolidWorks  → STEP              (File → Save As → STEP AP242)
Fusion 360  → STEP              (File → Export → STEP)
STL         → STL (repaired)    (trimesh repair + export)
DXF         → PDF               (ezdxf + matplotlib or pycairo)
```

## CLI tools

```bash
# FreeCAD headless conversion
freecad --convert-to step input.stp output.step

# Open CASCADE (OCCT) - draw_harness
DRAW> ReadStep s input.step
DRAW> WriteStep s output.step AP242

# Blender headless STL → GLB
blender --background --python-expr "
import bpy
bpy.ops.import_mesh.stl(filepath='input.stl')
bpy.ops.export_scene.gltf(filepath='output.glb')
"

# Meshmixer (STL repair, via CLI wrapper)
meshmixer --file input.stl --do RepairAll --file output.stl
```

## Checklist

- STEP AP242 is the modern standard — use it for new projects
- Always verify geometry after conversion (check volume, surface area)
- DXF for cutting: use layer naming convention (CUT, ETCH, SCORE)
- STL for printing: verify watertight before slicing
- GLTF for web: use draco compression for large meshes (`gltfpack -i model.glb -o compressed.glb`)
