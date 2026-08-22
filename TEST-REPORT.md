# Test report · v0.7.0 SLDASM Native Tessellation

## Automated synthetic test

- SLDASM-only input policy: PASS
- Modern chunk container detection: PASS
- ROL stream-name decode: PASS
- raw-deflate stream decompression: PASS
- COMPINSTANCETREE parse: PASS
- BOM grouping: PASS
- FaceTessellations face-block parse: PASS
- triangle-strip reconstruction: PASS
- meters → millimeters conversion: PASS
- mesh bounds: PASS
- assembly BOM SVG: PASS
- standalone SLDPRT rejection: PASS

## External real-file validation

- geometryAvailable: PASS
- BOM positions: 17
- occurrences: 31
- stream records: 68
- tessellation face blocks: 117
- vertices: 20 652
- triangles: 16 926
- bounds: 1271.763 × 663.000 × 476.000 mm

The external validation file is not included in the distribution.
