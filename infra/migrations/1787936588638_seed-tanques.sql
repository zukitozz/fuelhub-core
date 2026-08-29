-- 1787936588638_seed-tanques.sql
--
-- Carga inicial de `tanques` (sección 3.8.4) — a diferencia de
-- `productos_maestro` (seed único y global), este seed es POR ESTACIÓN: cada
-- una tiene su propia cantidad de tanques, capacidad y producto inicial.
--
-- ESTADO: COMPLETO con la data real que compartiste (CHANCAYLLO, MALA,
-- ANDAHUASI, PACHACUTEC) — 3 tanques por estación (Diésel/Premium/Regular),
-- 12 en total. VALIDADO de punta a punta contra un Postgres 16 real (DDL de
-- 3.3 + seed de productos_maestro + este seed): las 12 filas resultantes
-- coinciden exactamente con las capacidades de abajo, y una segunda corrida
-- del Up no agrega filas (ON CONFLICT confirmado). Ver changelog v1.43.
-- Antes de correrlo contra producción, por favor confirma 3
-- supuestos que tuve que asumir porque no venían explícitos en los datos que
-- pasaste (nada de esto bloquea seguir avanzando, pero si alguno está mal
-- hay que corregir el `INSERT` antes de ejecutar):
--
--   1. **"Petróleo" = Diésel.** Mapeé "petroleo"/"petorleo" al producto
--      `Diésel` de `productos_maestro` (3.8.1) — es el término coloquial
--      habitual en grifos peruanos para el diésel, pero quiero que lo
--      confirmes explícitamente antes de correr esto en serio.
--   2. **Los números son GALONES.** `productos_maestro.medida` de
--      Diésel/Premium/Regular es `GAL` (3.8.1) — asumí que 7000, 3000, etc.
--      ya vienen en esa unidad. Si en realidad me diste otra unidad
--      (barriles, litros), los `INSERT` de abajo quedarían con la capacidad
--      equivocada.
--   3. **1 tanque por producto, nombrado igual que el producto.** Diste un
--      número por producto por estación, así que asumí un solo tanque por
--      producto (`nombre` = 'Diésel'/'Premium'/'Regular') — no un desglose
--      de "2 tanques de Diésel de 3500 cada uno", por ejemplo. Si alguna
--      estación en realidad reparte un mismo producto en más de un tanque
--      físico, avísame para separar esas filas (el `UNIQUE(estacion_id,
--      nombre)` de 3.3 exige un nombre distinto por tanque en ese caso, p.
--      ej. "Diésel 1"/"Diésel 2").
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
