# Test report · ROZFOOD ENGINEERING STUDIO v0.6.1

## Automated regression

`npm test` — PASS.

Проверены:

- `sample_flange.step`: B-Rep, Ø, PCD, размеры, разрез;
- `sample_shaft.step`: ступени, диаметры, продольный вид и разрез;
- `sample_assembly.step`: 5 assembly occurrences, правильные габариты после трансформаций, сборочный BOM;
- SLDASM reference adapter: CFB/OLE, ссылки, количества, BOM;
- SVG title block и режим «Сборочный детализированный».

## Real STEP validation

Файл: `Сборка_Барабана_Глобино_….STEP` (пользовательский файл, не включён в сборку).

Результат локального парсинга:

- entities: 8 286;
- PRODUCT: 18;
- NEXT_ASSEMBLY_USAGE_OCCURRENCE: 31;
- displayed components: 28;
- scene edges: 610;
- scene faces: 450;
- planes in instances: 176;
- cylinders in instances: 138;
- cones in instances: 98;
- B-Spline curve definitions: 75;
- scene bounds: 475.999995 × 1225.000000 × 475.999987 mm.

Распознано имя корневого продукта: `Сборка Барабана Глобино`.

Статус: PASS для Import & Visualization Core v0.6.1.
