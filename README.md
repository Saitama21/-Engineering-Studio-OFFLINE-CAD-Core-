# Engineering Studio OFFLINE CAD Core v0.3.0

Первая сборка нового модульного офлайн-ядра Engineering Studio. Это не UI-макет: STEP/STP разбирается локально в браузере без AI, без API и без серверного CAD.

## Что уже реально работает

- Локальная загрузка `.step` / `.stp` через File API и drag & drop.
- Парсер ISO-10303-21 с индексом STEP entities.
- Разбор B-Rep топологии: body / shell / face / edge / vertex.
- Геометрия: LINE, CIRCLE, ELLIPSE, PLANE, CYLINDRICAL_SURFACE, CONICAL_SURFACE, SPHERICAL_SURFACE, TOROIDAL_SURFACE.
- Определение единиц STEP и перевод длины в mm.
- Точные габариты с учётом окружностей/эллипсов, а не только опорных точек.
- Распознавание цилиндрических диаметров и повторяющихся отверстий.
- Распознавание болтовой окружности / PCD по центрам одинаковых цилиндров.
- Автоматическая таблица размеров.
- Интерактивный офлайн 3D wireframe: вращение и zoom мышкой/пальцем.
- Генерация базового чертёжного листа из распознанной геометрии.
- STEP-сборки: PRODUCT, NEXT_ASSEMBLY_USAGE_OCCURRENCE, ITEM_DEFINED_TRANSFORMATION.
- Повторяющиеся компоненты располагаются по их assembly transforms.
- BOM/количество вхождений.
- Export локального JSON engineering report.
- Web Worker: тяжёлый STEP parsing не выполняется в основном UI-потоке.
- Service Worker + manifest + локальные иконки и sample STEP — после кэширования ядро не требует интернета.

## Встроенные тестовые модели

- `samples/sample_flange.step`: фланец Ø80 × 12, центральное Ø20, 6×Ø6 на PCD Ø60.
- `samples/sample_shaft.step`: ступенчатый вал Ø36 / Ø30 / Ø20 длиной 90.
- `samples/sample_assembly.step`: плита + 4 одинаковых болта с assembly transforms.

Кнопки **Фланец / Вал / Сборка** позволяют прогнать ядро без собственного файла.

## Важно про SolidWorks

`SLDPRT` и `SLDASM` — закрытые нативные форматы SolidWorks. v0.3.0 их определяет, но намеренно не делает вид, что умеет декодировать. Для текущего ядра экспортируйте из SolidWorks в STEP (`.step/.stp`).

Это не тупиковый путь: Import Core отделён от Recognition Core. Позже можно подключить отдельный нативный SolidWorks/Parasolid адаптер, не переписывая распознавание, размеры, drawing и assembly modules.

## Что ещё НЕ является full SolidWorks replacement

- B-Spline/NURBS в wireframe пока отображаются упрощённо; STEP entity сохраняется и учитывается в статистике.
- Пока нет полноценной тесселяции B-Rep в shaded mesh.
- Авточертёж сейчас базовый, не ГОСТ production drawing.
- Нет PMI/GD&T/MBD импорта, если информация хранится в специальных AP242 presentation/semantic entities.
- Нет редактирования импортированного B-Rep/feature tree.
- Нет нативного SLDPRT/SLDASM decoding.

## Запуск

Лучше через HTTP/HTTPS (нужно для Service Worker):

```bash
python3 -m http.server 8080
```

Откройте `http://localhost:8080`.

## GitHub Pages

Загрузите содержимое папки в корень репозитория и включите Pages из `main / root`. Все runtime-модули лежат локально; CDN не используется.

## Railway

Для Railway достаточно любого static server, раздающего эту папку по HTTPS. Backend для распознавания STEP не нужен.

## Главный принцип проекта

`Import Core → CAD/Topology Core → Recognition Core → Dimension Core → Drawing Core → Assembly Core`

Интерфейс может меняться, а математическое ядро остаётся независимым и тестируемым.


## v0.3.1 Light UI
- Светлый контрастный режим по умолчанию: белые панели, почти чёрный текст, Apple-like blue accent.
- Тёмная тема сохранена; переключение ☀︎/☾ в верхней панели.
- Выбор темы сохраняется локально и работает офлайн.
- CAD canvas меняет фон, сетку и цвет геометрии вместе с темой.
