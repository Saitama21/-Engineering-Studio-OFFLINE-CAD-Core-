# SLDASM-only policy — v0.6.1

- SolidWorks native input exposed to the user: **.SLDASM only**.
- Standalone **.SLDPRT is intentionally rejected** by the file picker and importer.
- STEP/STP remains supported as the exact B-Rep interchange path.
- The SLDASM adapter still recognizes `.SLDPRT` references *inside an assembly* for BOM/component naming; that does not mean standalone SLDPRT import is supported.
- Legacy OLE/CFB SLDASM files can be scanned for component references locally.
- Newer opaque SolidWorks binary containers are detected as SLDASM, but exact B-Rep decoding still requires a dedicated native SolidWorks-compatible decoder/SDK.
