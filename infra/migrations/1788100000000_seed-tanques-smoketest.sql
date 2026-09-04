-- 1788100000000_seed-tanques-smoketest.sql
--
-- Carga tanques para la estación SMOKETEST (1787940000000_seed-estacion-smoketest.sql)
-- -- a pedido de Jorge (2026-09-04), para poder probar GET/PUT /tanques de
-- verdad contra `dev`/`prod` sin usar una de las 4 estaciones reales
-- (CHANCAYLLO/MALA/ANDAHUASI/PACHACUTEC).
--
-- El seed original de SMOKETEST (v1.52) decía explícitamente que esta
-- estación "no necesita fila en tanques" porque el detalle sintético del
-- smoke-test usa `codigoLocal`, no `productoId` (sección 3.8.1.1) -- eso
-- sigue siendo cierto para `scripts/smoke-test.mjs`; esta migración no le
-- cambia nada a ese flujo, solo agrega data para pruebas manuales del
-- endpoint de tanques (Postman) que antes no tenía nada que listar.
--
-- Mismo criterio que 1787936588638_seed-tanques.sql (1 tanque por producto,
-- nombrado igual que el producto), pero para los 5 productos del catálogo
-- cruzado (no solo Diésel/Premium/Regular como las 4 estaciones reales) --
-- SMOKETEST no es una estación real con una mezcla de productos conocida,
-- así que no hay razón para dejar afuera GLP/GNV.
--
-- `capacidad` ALEATORIA (a pedido explícito) en vez de un valor fijo por
-- producto: se calcula una sola vez, al momento del INSERT (no es una
-- columna computada) -- ROUND(1000 + random() * 9000, 2), mismo orden de
-- magnitud que las capacidades reales de 1787936588638 (2500-16000). No
-- pretende ser realista por producto (una estación de pruebas no necesita
-- que la capacidad del tanque de Diésel "tenga sentido"), solo dar un valor
-- de prueba != 0 que se pueda ver en un PUT/GET real.
--
-- `ON CONFLICT (estacion_id, nombre) DO NOTHING` -- mismo criterio de
-- idempotencia que el resto de los seeds: si esta migración corre dos veces
-- (o si alguien ya creó tanques para SMOKETEST a mano), no duplica ni
-- pisa la capacidad ya cargada.

-- Up Migration

INSERT INTO tanques (estacion_id, producto_id, nombre, capacidad, stock_minimo)
SELECT e.id, pm.id, pm.nombre, ROUND((1000 + random() * 9000)::numeric, 2), NULL
FROM estaciones e
JOIN productos_maestro pm ON true
WHERE e.codigo = 'SMOKETEST'
ON CONFLICT (estacion_id, nombre) DO NOTHING;

-- Down Migration

DELETE FROM tanques t
USING estaciones e
WHERE t.estacion_id = e.id
  AND e.codigo = 'SMOKETEST';
