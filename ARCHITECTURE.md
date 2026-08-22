# Architecture

## import/step-parser.js
Детерминированный парсер ISO-10303-21. Превращает STEP DATA section в Map entities и индекс byType.

## recognition/feature-recognizer.js
Извлекает B-Rep геометрию, поверхности, точные габариты, цилиндры, PCD и assembly occurrences. Применяет `ITEM_DEFINED_TRANSFORMATION` к инстансам деталей.

## drawing/drawing-engine.js
Преобразует Recognition Model в базовый технический лист SVG. Следующий этап: проекции, скрытые линии, разрезы, размерные стратегии.

## viewer/wireframe-viewer.js
Локальный Canvas 3D viewer без CDN. Использует геометрические EDGE_CURVE и assembly transforms.

## import-worker.js
Запускает STEP parsing и recognition вне UI thread.

## app.js
UI orchestration. Не содержит CAD-математику.

## Следующие ядра

1. Tessellation Core — точный shaded mesh из B-Rep.
2. Feature Recognition 2 — отверстия, фаски, скругления, карманы, ступени, резьбовые кандидаты.
3. Projection Core — front/top/right/section views + hidden line removal.
4. Dimension Strategy — базовые/цепные/ординатные размеры и удаление дубликатов.
5. AP242 PMI Core — semantic dimensions/GD&T, когда они реально присутствуют в STEP.
6. Native SolidWorks/Parasolid Adapter — отдельный импортный модуль.
