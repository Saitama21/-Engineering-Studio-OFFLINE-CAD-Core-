# SLDASM Adapter v0.4.1

Полностью локальный модуль импорта структуры SolidWorks Assembly.

## Что делает
- определяет OLE/CFB-контейнер SLDASM;
- извлекает printable ASCII/UTF-16LE metadata;
- находит ссылки `.SLDPRT` / `.SLDASM`;
- эвристически распознаёт экземпляры `Part-1`, `Part-2`, ...;
- строит дерево компонентов и предварительный BOM;
- экспортирует данные в engineering report JSON.

## Ограничение
Это reference-level адаптер, а не декодер закрытого геометрического ядра SolidWorks. Геометрия B-Rep, размеры и авточертёж для SLDASM требуют STEP-экспорта.
