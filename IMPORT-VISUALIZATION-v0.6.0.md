# Import & Visualization Core v0.6.0

## Поток импорта STEP

1. STEP parser читает ISO-10303-21 и декодирует строки.
2. Product graph связывает `PRODUCT_DEFINITION` с shape representation.
3. `CONTEXT_DEPENDENT_SHAPE_REPRESENTATION` определяет экземпляры сборки.
4. `ITEM_DEFINED_TRANSFORMATION` преобразуется в rigid transform.
5. Трансформации вложенных подсборок композиционно накапливаются до корня.
6. Для каждого экземпляра разворачиваются B-Rep edges/faces/surfaces.
7. Viewer получает одну готовую мировую сцену.

## Viewer

- Объём: проекционная заливка face loops + CAD edges.
- Каркас: только точные/аппроксимированные B-Rep edges.
- Orbit: drag.
- Zoom: wheel/pinch event path браузера.
- Component picking: по проекции граней.
- Component isolation emphasis: выбранная деталь остаётся яркой, остальные приглушаются.

## Геометрия кривых

- LINE: вершины EDGE_CURVE.
- CIRCLE/ELLIPSE: реальная дуга между вершинами с учётом same-sense.
- B_SPLINE_CURVE_WITH_KNOTS: локальный de Boor sampler.

Это детерминированная геометрия; AI не используется.
