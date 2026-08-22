# ROZFOOD Engineering Studio v0.7.0 architecture

## Import layer

`import/sldasm-adapter.js`

- SLDASM-only gate
- modern SolidWorks chunk-stream parser
- ROL stream-name codec
- raw-deflate decompression
- COMPINSTANCETREE XML decoder
- FaceTessellations triangle-strip decoder

`import-worker.js`

- isolates parsing from UI thread
- returns recognition record, assembly metadata and mesh bounds

## Visualization

`viewer/wireframe-viewer.js`

- Canvas 2D projected 3D viewer
- filled triangle mode (`Объём`)
- batched triangle-edge mode (`Каркас`)
- pointer rotation and wheel zoom
- requestAnimationFrame throttling for large meshes

## Drawing/BOM

`drawing/drawing-engine.js`

- detailed assembly/BOM sheet remains available from the decoded component tree
- exact engineering projections from native SLDASM are intentionally blocked until a B-Rep layer exists

## Data honesty rule

FaceTessellations are labelled as TESS geometry. They are never presented as exact B-Rep/feature dimensions.
