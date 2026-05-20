---
name: fusion360-api
description: Script and automate Autodesk Fusion 360 using the Python API. Use this skill for creating parametric models, automating toolpaths, generating drawings, and exporting files from Fusion 360.
category: metalworking
tags:
  - fusion360
  - autodesk
  - python
  - cad
  - cam
  - automation
version: 1.0.0
---

# Fusion 360 API

Automate Fusion 360 with Python scripts. Scripts run inside Fusion via Tools → Scripts and Add-Ins → Scripts → Run, or as Add-Ins for persistent functionality.

## Script boilerplate

```python
import adsk.core, adsk.fusion, adsk.cam, traceback

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        design: adsk.fusion.Design = app.activeProduct
        root: adsk.fusion.Component = design.rootComponent
        
        # Your code here
        
    except Exception:
        if ui:
            ui.messageBox("Failed:\n{}".format(traceback.format_exc()))
```

## Create a parametric body

```python
def create_bracket(root: adsk.fusion.Component, width_mm=60, height_mm=40, thickness_mm=5):
    """Create a simple flat bracket."""
    sketches = root.sketches
    xy_plane = root.xYConstructionPlane
    sketch = sketches.add(xy_plane)

    lines = sketch.sketchCurves.sketchLines
    w = width_mm / 10  # cm (Fusion internal unit)
    h = height_mm / 10
    
    # Rectangle from origin
    pt0 = adsk.core.Point3D.create(0, 0, 0)
    pt1 = adsk.core.Point3D.create(w, 0, 0)
    pt2 = adsk.core.Point3D.create(w, h, 0)
    pt3 = adsk.core.Point3D.create(0, h, 0)
    lines.addByTwoPoints(pt0, pt1)
    lines.addByTwoPoints(pt1, pt2)
    lines.addByTwoPoints(pt2, pt3)
    lines.addByTwoPoints(pt3, pt0)

    # Extrude
    prof = sketch.profiles.item(0)
    extrudes = root.features.extrudeFeatures
    ext_input = extrudes.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    dist = adsk.core.ValueInput.createByReal(thickness_mm / 10)
    ext_input.setDistanceExtent(False, dist)
    return extrudes.add(ext_input)
```

## Add holes (circular pattern)

```python
def add_mounting_holes(root: adsk.fusion.Component, body: adsk.fusion.BRepBody,
                        diameter_mm=6.0, depth_mm=10.0):
    """Add M6 through-holes at four corners."""
    holes = root.features.holeFeatures
    
    # Select top face
    face = None
    for f in body.faces:
        if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
            normal = f.evaluator.getNormalAtPoint(f.pointOnFace)[1]
            if abs(normal.z - 1.0) < 0.01:
                face = f
                break

    if not face:
        return

    hole_input = holes.createSimpleInput(
        adsk.core.ValueInput.createByString(f"{diameter_mm} mm")
    )
    hole_input.setPositionByPoint(
        face,
        adsk.core.Point3D.create(1.0, 1.0, 0)  # 10mm from corner in cm
    )
    hole_input.setDistanceExtent(
        adsk.core.ValueInput.createByString(f"{depth_mm} mm")
    )
    hole_input.isDefaultDirection = True
    holes.add(hole_input)
```

## Apply material

```python
def apply_material(design: adsk.fusion.Design, body: adsk.fusion.BRepBody, material_name="Aluminum 6061"):
    lib = app.materialLibraries.itemByName("Fusion 360 Material Library")
    mat = lib.materials.itemByName(material_name)
    if mat:
        body.material = mat
```

## CAM: set up a 2D contour toolpath

```python
def setup_cam_contour(design: adsk.fusion.Design):
    cam: adsk.cam.CAM = adsk.cam.CAM.cast(design)
    if not cam:
        # Switch to Manufacturing workspace first
        return

    setups = cam.setups
    setup_input = setups.createInput(adsk.cam.OperationTypes.MillingOperation)
    setup_input.name = "Main Setup"
    setup = setups.add(setup_input)

    # Add 2D contour operation
    ops = setup.operations
    op_input = ops.createInput("2d_contour")
    op_input.parameters.itemByName("tolerance").value.value = 0.001  # cm
    op_input.parameters.itemByName("stockToLeave").value.value = 0.0
    ops.add(op_input)
```

## Export STEP / DXF

```python
def export_step(design: adsk.fusion.Design, output_path: str):
    export_mgr = design.exportManager
    step_options = export_mgr.createSTEPExportOptions(output_path)
    export_mgr.execute(step_options)

def export_dxf(sketch: adsk.fusion.Sketch, output_path: str):
    sketch.saveAsDXF(output_path)
```

## Parameters (parametric control)

```python
def set_parameter(design: adsk.fusion.Design, name: str, value_mm: float):
    """Update a user parameter by name."""
    params = design.userParameters
    param = params.itemByName(name)
    if param:
        param.expression = f"{value_mm} mm"
    else:
        params.add(name, adsk.core.ValueInput.createByString(f"{value_mm} mm"), "mm", "")
```

## Fusion 360 unit conventions

- Internal unit: **centimeters (cm)**
- `Point3D.create(x, y, z)` — values in cm
- `ValueInput.createByString("10 mm")` — unit-aware string input (preferred)
- `ValueInput.createByReal(1.0)` — assumes cm

## Add-In vs Script

| | Script | Add-In |
|---|---|---|
| Persistent | No | Yes |
| Auto-run on startup | No | Yes |
| Has UI panel | No | Yes |
| Use for | One-shot automation | Workflow tools |

## Checklist

- Always wrap code in `try/except` and surface errors via `ui.messageBox`
- Use `ValueInput.createByString` with units for clarity
- Call `adsk.terminate()` at the end of scripts (not add-ins)
- For assemblies: work with `occurrence.component` not root component
- Save the design before exporting (`app.activeDocument.save("")`)
