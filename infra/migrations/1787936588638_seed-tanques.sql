-- 1787936588638_seed-tanques.sql
--
-- Carga inicial de `tanques` (sección 3.8.4) — a diferencia de
-- `productos_maestro` (seed único y global), este seed es POR ESTACIÓN: cada
-- una tiene su propia cantidad de tanques, capacidad y producto inicial.
--
-- ESTADO: COMPLETO y CONFIRMADO con la data real (CHANCAYLLO, MALA,
-- ANDAHUASI, PACHACUTEC) — 3 tanques por estación (Diésel/Premium/Regular),
-- 12 en total. VALIDADO de punta a punta contra un Postgres 16 real (DDL de
-- 3.3 + seed de productos_maestro + este seed): las 12 filas resultantes
-- coinciden exactamente con las capacidades de abajo, y una segunda corrida
-- del Up no agrega filas (ON CONFLICT confirmado). Ver changelog v1.43.
--
-- Los 3 supuestos que este archivo dejaba pendientes de confirmar quedaron
-- CONFIRMADOS por Jorge (changelog v1.56), sin cambios en los `INSERT` de
-- abajo (la data que reenvió calza exacta con la ya cargada):
--   1. **"Petróleo" = Diésel** — término coloquial habitual en grifos
--      peruanos, confirmado explícitamente.
--   2. **Los números son GALONES** — coincide con `productos_maestro.medida`
--      de Diésel/Premium/Regular (`GAL`, 3.8.1), confirmado explícitamente.
--   3. **1 tanque por producto, nombrado igual que el producto** — Jorge
--      confirmó explícitamente "único tanque por producto" para las 4
--      estaciones; no hace falta desglosar ningún producto en más de un
--      tanque físico.
--
-- `stock_minimo` queda en NULL en los 12 — no lo mencionaste, y es opcional
-- (columna nullable, 3.3). Si manejan un umbral real de reabastecimiento por
-- tanque, lo agrego en una migración aparte (no hace falta re-ejecutar esta).
--
-- Depende de que ya haya corrido el seed de `productos_maestro`
-- (1787936588637_seed-productos-maestro.sql) y de que las 4 estaciones ya
-- existan en la tabla `estaciones` (alta inicial fuera de este archivo,
-- junto con el resto del despliegue) — resuelve `estacion_id`/`producto_id`
-- por `codigo`/`nombre` en vez de UUID hardcodeado, para no depender de que
-- alguien copie IDs a mano. `ON CONFLICT ... DO NOTHING` hace la migración
-- segura de reintentar (idempotente) si se corre dos veces por error.

-- Up Migration

-- PACHACUTEC — Diésel 7000 GAL, Premium 3000 GAL, Regular 3000 GAL.
INSERT INTO tanques (estacion_id, producto_id, nombre, capacidad, stock_minimo)
SELECT e.id, pm.id, pm.nombre, capacidades.valor, NULL
FROM estaciones e
JOIN (VALUES ('Diésel', 7000), ('Premium', 3000), ('Regular', 3000)) AS capacidades(producto_nombre, valor)
  ON true
JOIN productos_maestro pm ON pm.nombre = capacidades.producto_nombre
WHERE e.codigo = 'PACHACUTEC'
ON CONFLICT (estacion_id, nombre) DO NOTHING;

-- MALA — Diésel 7500 GAL, Premium 5000 GAL, Regular 2500 GAL.
INSERT INTO tanques (estacion_id, producto_id, nombre, capacidad, stock_minimo)
SELECT e.id, pm.id, pm.nombre, capacidades.valor, NULL
FROM estaciones e
JOIN (VALUES ('Diésel', 7500), ('Premium', 5000), ('Regular', 2500)) AS capacidades(producto_nombre, valor)
  ON true
JOIN productos_maestro pm ON pm.nombre = capacidades.producto_nombre
WHERE e.codigo = 'MALA'
ON CONFLICT (estacion_id, nombre) DO NOTHING;

-- ANDAHUASI — Diésel 10000 GAL, Premium 5000 GAL, Regular 5000 GAL.
INSERT INTO tanques (estacion_id, producto_id, nombre, capacidad, stock_minimo)
SELECT e.id, pm.id, pm.nombre, capacidades.valor, NULL
FROM estaciones e
JOIN (VALUES ('Diésel', 10000), ('Premium', 5000), ('Regular', 5000)) AS capacidades(producto_nombre, valor)
  ON true
JOIN productos_maestro pm ON pm.nombre = capacidades.producto_nombre
WHERE e.codigo = 'ANDAHUASI'
ON CONFLICT (estacion_id, nombre) DO NOTHING;

-- CHANCAYLLO — Diésel 16000 GAL, Premium 4000 GAL, Regular 4000 GAL.
INSERT INTO tanques (estacion_id, producto_id, nombre, capacidad, stock_minimo)
SELECT e.id, pm.id, pm.nombre, capacidades.valor, NULL
FROM estaciones e
JOIN (VALUES ('Diésel', 16000), ('Premium', 4000), ('Regular', 4000)) AS capacidades(producto_nombre, valor)
  ON true
JOIN productos_maestro pm ON pm.nombre = capacidades.producto_nombre
WHERE e.codigo = 'CHANCAYLLO'
ON CONFLICT (estacion_id, nombre) DO NOTHING;

-- Down Migration

DELETE FROM tanques t
USING estaciones e
WHERE t.estacion_id = e.id
  AND e.codigo IN ('PACHACUTEC', 'MALA', 'ANDAHUASI', 'CHANCAYLLO')
  AND t.nombre IN ('Diésel', 'Premium', 'Regular');
