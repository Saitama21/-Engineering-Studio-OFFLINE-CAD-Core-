# TEST REPORT · v0.8.1 Drawing Layout Core

## Automated tests

`npm test` — PASS.

Проверено:
- SLDASM-only импорт;
- дерево компонентов и BOM;
- assembly transforms;
- FaceTessellations;
- TESS cylinder recognition;
- новый production sheet renderer;
- наличие A–A, спецификации и A2-style viewBox 1400×990.

## Real assembly validation

Контрольный файл: `Сборка Барабана Глобино.SLDASM`.

Результат:
- 17 BOM позиций;
- 31 вхождение;
- 25 962 треугольника сцены;
- габарит 476 × 1225 × 476 мм;
- 86 плоскостей;
- 67 цилиндров;
- 36 отверстий;
- автоматический масштаб листа 1:5;
- сформирован A2-style сборочный лист с продольными/торцевыми/изометрическими видами, A–A, C/D, позициями, BOM и основной надписью.

## Accuracy status

`TESS / VERIFY`: точный Parasolid B-Rep не декодируется в этой версии.
