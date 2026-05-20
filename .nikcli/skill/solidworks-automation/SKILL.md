---
name: solidworks-automation
description: Automate SolidWorks using VBA macros and the SolidWorks API. Use this skill when creating, modifying, or exporting SolidWorks parts, assemblies, and drawings programmatically. Covers macro recording, API calls, design tables, and batch operations.
category: metalworking
tags:
  - solidworks
  - vba
  - cad
  - automation
  - macros
version: 1.0.0
---

# SolidWorks Automation

Automate SolidWorks through its COM-based API. Works via VBA macros (Tools → Macros), the SolidWorks API SDK, or external applications using `SldWorks.Application`.

## Setup

**VBA macro**: Tools → Macro → New → save as `.swp`
**External app**: Add reference to `SldWorks 20xx Type Library` in your project

```vba
' Standard macro header
Dim swApp As SldWorks.SldWorks
Dim swModel As SldWorks.ModelDoc2
Dim swPart As SldWorks.PartDoc

Sub main()
    Set swApp = Application.SldWorks
    Set swModel = swApp.ActiveDoc
    Set swPart = swModel
End Sub
```

## Core patterns

### Open / create a part

```vba
' Open existing part
Dim errors As Long, warnings As Long
Set swModel = swApp.OpenDoc6( _
    "C:\parts\bracket.sldprt", _
    swDocPART, _
    swOpenDocOptions_Silent, "", errors, warnings)

' Create new part
Set swModel = swApp.NewDocument( _
    swApp.GetUserPreferenceStringValue(swUserPreferenceStringValue_e.swDefaultTemplatePart), _
    0, 0, 0)
```

### Modify dimensions

```vba
Dim swFeat As SldWorks.Feature
Dim swDim As SldWorks.Dimension

' Get dimension by name (set in feature manager)
Set swDim = swModel.Parameter("D1@Sketch1")
swDim.SystemValue = 0.05  ' Always in meters internally

swModel.EditRebuild3
```

### Create sketch geometry

```vba
Dim swSketch As SldWorks.SketchManager
Set swSketch = swModel.SketchManager

swModel.InsertSketch2 True  ' begin sketch on selected plane
swSketch.CreateLine 0, 0, 0, 0.1, 0, 0  ' x1,y1,z1, x2,y2,z2 (meters)
swSketch.CreateCircleByRadius 0.025, 0.025, 0, 0.01  ' cx,cy,cz,r
swModel.InsertSketch2 True  ' end sketch
```

### Extrude a boss

```vba
Dim swFeatMgr As SldWorks.FeatureManager
Set swFeatMgr = swModel.FeatureManager

' Boss-Extrude: 20mm depth
swFeatMgr.FeatureExtrusion3 _
    True, False, False, _
    swEndCondBlind, swEndCondBlind, _
    0.02, 0, _          ' depth (meters), draft angle
    False, False, False, False, _
    0, 0, False, False, False, False, True, True, True, _
    0, 0, False
```

### Add holes with Hole Wizard

```vba
' M6 through-hole at (30mm, 20mm) on top face
swModel.ClearSelection2 True
swModel.Extension.SelectByID2 "Top Plane", "PLANE", 0, 0, 0, False, 0, Nothing, 0

swFeatMgr.HoleWizard5 _
    wbhSmartFit, swWzdHoleTypes_Counterbore, swStandardISO, "M6", _
    swEndCondThroughAll, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, _
    0, 0, 0, 0, 0, 0, 0.03, 0.02, 0, 0, 0, 0, 0, 0, False, False
```

### Export to STEP / DXF

```vba
' Export STEP
swModel.SaveAs4 "C:\output\part.step", swSaveAsCurrentVersion, swSaveAsOptions_Silent, errors, warnings

' Export DXF from drawing sheet
Dim swDraw As SldWorks.DrawingDoc
swDraw.ExportToDWG2 "C:\output\part.dxf", swModel.GetPathName(), swExportToDWG_ExportSelectedSheet, _
    True, Nothing, False, False, 0, Nothing
```

### Design table (Excel-driven configurations)

```vba
' Insert design table
Dim swDesignTable As SldWorks.DesignTable
Set swDesignTable = swModel.InsertFamilyTableOpen2("C:\tables\bracket_variants.xlsx", False, True)

' Switch active configuration
swModel.ShowConfiguration2 "CONFIG_M8_HOLES"
swModel.EditRebuild3
```

### Batch process folder

```vba
Sub BatchExport()
    Dim path As String: path = "C:\parts\"
    Dim f As String: f = Dir(path & "*.sldprt")
    
    Do While f <> ""
        Dim errors As Long, warnings As Long
        Set swModel = swApp.OpenDoc6(path & f, swDocPART, swOpenDocOptions_Silent, "", errors, warnings)
        swModel.SaveAs4 path & "step\" & Replace(f, ".sldprt", ".step"), _
            swSaveAsCurrentVersion, swSaveAsOptions_Silent, errors, warnings
        swApp.CloseDoc swModel.GetPathName()
        f = Dir()
    Loop
End Sub
```

## Custom properties (metadata)

```vba
Dim swCustProp As SldWorks.CustomPropertyManager
Set swCustProp = swModel.Extension.CustomPropertyManager("")

swCustProp.Add3 "Material", swCustomInfoText, "6061-T6 Aluminum", swCustomPropertyReplaceValue
swCustProp.Add3 "PartNumber", swCustomInfoText, "BKT-001-A", swCustomPropertyReplaceValue
swCustProp.Add3 "Finish", swCustomInfoText, "Hard Anodize Class II", swCustomPropertyReplaceValue
```

## PDM / Vault integration

```vba
' Check in to PDM Standard vault
Dim swEDMVault As EdmVault5
Set swEDMVault = New EdmVault5
swEDMVault.LoginAuto "VaultName", 0

Dim swFile As IEdmFile5
Set swFile = swEDMVault.GetFileFromPath("C:\Vault\parts\bracket.sldprt", Nothing)
swFile.UnlockFile 0, "Updated M6 to M8 holes"
```

## Common error codes

| Code | Meaning |
|------|---------|
| `swFileNotFoundError` | File path wrong or locked |
| `swFeatureRebuildError` | Geometry problem after dimension change |
| `swInvalidArgument` | Wrong unit — remember: always meters in API |

## Checklist

- All API length values are in **meters** (convert: mm → divide by 1000)
- Angles are in **radians** (convert: degrees × π/180)
- Call `swModel.EditRebuild3` after changing dimensions
- Use `swModel.ClearSelection2 True` before new selections
- For assemblies, use `SldWorks.AssemblyDoc` not `PartDoc`
