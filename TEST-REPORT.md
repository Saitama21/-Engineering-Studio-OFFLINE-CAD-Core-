# Test report · ROZFOOD ENGINEERING STUDIO v0.4.1

Дата сборки: 2026-08-22

`npm test` — PASS.

Проверено:

- sample_flange.step: 80×80×12 mm, 6×Ø6, PCD Ø60, главный вид XY, A–A создан.
- sample_shaft.step: 36×36×90 mm, Ø36/Ø30/Ø20, длины ступеней 30/35/25 mm, главный вид XZ, A–A создан.
- sample_assembly.step: 80×50×45 mm, 5 instances, assembly recognition сохранён.
- SVG smoke render содержит бренд ROZFOOD ENGINEERING STUDIO, версию Drawing Core v0.4.1 и PCD-аннотацию для фланца.
- Синтаксис `app.js`, `drawing/drawing-engine.js`, `recognition/feature-recognizer.js` проверен `node --check`.
