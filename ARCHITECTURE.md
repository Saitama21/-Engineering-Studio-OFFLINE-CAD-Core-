# ROZFOOD Engineering Studio v0.7.1 architecture

`SLDASM → Native Streams → COMPINSTANCETREE + FaceTessellations → Model/Tess mapping → Occurrence transforms → 3D scene → BOM / Drawing`

## Import pipeline

1. `sldasm-adapter.js` декодирует SolidWorks 2015+ chunk container.
2. `COMPINSTANCETREE` даёт модели, BOM, вложенность и `swTransform`.
3. `FaceTessellations/*` декодируются в локальные triangle-strip templates.
4. Локальные шаблоны сопоставляются с leaf-моделями по `swBoundingBox`, порядку моделей и границам tess-потоков.
5. Матрицы вхождений накапливаются в row-vector convention: `local × parentWorld`.
6. Каждая копия детали переносится в мировые координаты и получает `componentId`.
7. Viewer сортирует треугольники по глубине, поддерживает solid/wireframe и выбор детали.

Все вычисления выполняются в браузере локально.
