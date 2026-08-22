# Test report · ROZFOOD ENGINEERING STUDIO v0.5.0

`npm test` проверяет:

- sample_flange.step: B-Rep, габариты, PCD, главный вид, разрез;
- sample_shaft.step: B-Rep, главный продольный вид, разрез, длины ступеней;
- sample_assembly.step: assembly transforms, BOM, сборочный детализированный SVG;
- SLDASM Native Reference Adapter: CFB/OLE signature, ссылки, BOM;
- SLDASM BOM-лист в Drawing Core;
- наличие версии `Drawing Core v0.5.0` в SVG.

Статус последнего прогона: **PASS**.
