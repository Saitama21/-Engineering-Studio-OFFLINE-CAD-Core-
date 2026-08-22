# Test report · v0.7.1 SLDASM Assembly Transforms

## Synthetic transform test

PASS:
- `.SLDASM` принят;
- `.SLDPRT` отклонён;
- локальная плоскость 100×100 мм с translation `(200,300,400)` мм оказалась в ожидаемых мировых координатах;
- `componentId` присвоен сценовым треугольникам;
- Drawing Core маркирован v0.7.1.

## Real SLDASM validation

Файл: `Сборка Барабана Глобино.SLDASM`

PASS:
- 17 BOM-позиций;
- 31 вхождение;
- 14/14 leaf-моделей сопоставлены;
- 28 leaf-вхождений размещены;
- 117 tess-блоков;
- 16 926 исходных triangles;
- 25 962 scene triangles;
- итоговый bounding box ≈ 476 × 1225 × 476 мм;
- длинная локальная ось/вал больше не остаётся в локальной X-ориентации: матрица сборки применена.
