# Engineering Studio v0.3.1 — Light UI

## Реализовано
- Светлая высококонтрастная тема по умолчанию.
- Apple-like blue accent, белые панели, почти чёрный инженерный текст.
- Переключатель ☀︎/☾ в верхней панели; доступен и на мобильном layout.
- Выбранная тема сохраняется в localStorage и работает офлайн.
- Canvas 3D автоматически меняет фон, сетку, цвет рёбер и окружностей вместе с темой.
- PWA `theme_color` / `background_color` обновлены под светлый режим.
- Service Worker cache version повышена до `v0.3.1-light`, чтобы обновление стилей не застревало в старом офлайн-кэше.

## Проверки
- `app.js` — синтаксис Node OK.
- `viewer/wireframe-viewer.js` — синтаксис Node OK.
- STEP regression tests — OK для flange / shaft / assembly.
- Попытка автоматического screenshot через системный Chromium в sandbox зависла на окружении; поэтому браузерный screenshot не включён как доказательство.
