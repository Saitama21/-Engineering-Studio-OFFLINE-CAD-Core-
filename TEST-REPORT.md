# Test Report — v0.3.0

Дата: 2026-08-22

## Автоматические Node tests

`npm test` — PASS.

### sample_flange.step
- 762 STEP entities
- 1 solid
- 10 faces
- 24 edges
- bounding box: 80.000 × 80.000 × 12.000 mm
- recognized diameters: Ø80, Ø20, Ø6 × 6
- recognized PCD: Ø60.000, 6 × Ø6.000

### sample_shaft.step
- 298 STEP entities
- 1 solid
- 7 faces
- 9 edges
- bounding box: 36.000 × 36.000 × 90.000 mm
- recognized diameters: Ø36, Ø30, Ø20

### sample_assembly.step
- 521 STEP entities
- 2 unique B-Rep definitions
- 5 assembly occurrences
- ITEM_DEFINED_TRANSFORMATION applied to component instances
- bounding box: 80.000 × 50.000 × 45.000 mm
- four repeated Ø8 cylindrical components recognized in transformed positions

## Syntax tests

`node --check` PASS:
- app.js
- import-worker.js
- import/step-parser.js
- recognition/feature-recognizer.js
- viewer/wireframe-viewer.js
- drawing/drawing-engine.js

## Browser E2E

Не выполнен в текущем build-container: установленный Chromium блокирует локальные `http://127.0.0.1`, container IP и `file://` политикой `ERR_BLOCKED_BY_ADMINISTRATOR`. Это ограничение среды тестирования, не заявляется как PASS.

Перед production deployment всё равно нужно прогнать Safari iOS / Chrome desktop на реальном HTTPS host.
