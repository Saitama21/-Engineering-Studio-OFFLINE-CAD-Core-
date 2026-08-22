# ROZFOOD Engineering Studio v0.8.0 architecture

`SLDASM → Native Streams → COMPINSTANCETREE + FaceTessellations → Model/Tess mapping → Assembly transforms → 3D scene → Tess Geometry Recognition → Dimensions / Drawing / BOM`

## Recognition pipeline

`core/tess-recognition.js` группирует треугольники по исходной tess-face и компоненту.

- Plane detector: coherence нормалей + RMS отклонения от средней плоскости.
- Cylinder detector: матрица распределения нормалей → ось → проекция в поперечную плоскость → circle fit → радиус/диаметр/длина.
- Inner/outer classification: знак направления нормали относительно радиального вектора.
- Axis clustering: близкие цилиндрические оси объединяются в доминирующие направления.
- Drawing: `drawing/tess-recognition-drawing.js` строит TESS/VERIFY главный и торцевой виды с базовыми размерами.

Все вычисления выполняются локально в браузере.
