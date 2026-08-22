# SLDASM Native Tessellation Decoder v0.7.0

## Pipeline

1. Проверка расширения `.SLDASM`.
2. Поиск modern SolidWorks chunk marker `14 00 06 00 08 00`.
3. Декодирование имён stream через ROL-ключ из заголовка файла.
4. Локальная raw-deflate распаковка нужных потоков.
5. `COMPINSTANCETREE` → дерево сборки, вхождения, BOM.
6. `FaceTessellations/NNN-NNN-NNN` → face blocks.
7. Face block → позиции + нормали + vertex-group table.
8. Vertex group → triangle strip с чередованием winding.
9. Внутренние координаты SolidWorks tessellation `m` → `mm`.
10. Треугольники → Canvas 3D viewer.

## Геометрический уровень

Это display tessellation. Она достаточна для отображения реальной формы, вращения, каркаса и вычисления mesh bounds.

Она не заменяет точный Parasolid B-Rep: topology/features/analytic surfaces пока не восстанавливаются.
