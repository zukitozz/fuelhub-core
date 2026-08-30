-- 1787950000000_actualiza-ruc-estaciones-nonato.sql
--
-- Completa `estaciones.ruc` (VARCHAR(11)) de las 4 estaciones reales del
-- grupo "nonato" — dato que `1787920000000_seed-estaciones-nonato.sql`
-- dejaba a propósito en NULL (9.2.1: "RUC aún no compartido"), con esa
-- misma migración anotando que se completaría con un `UPDATE` aparte, sin
-- volver a correrla, en cuanto Jorge lo confirme (v1.52). No se edita la
-- migración original porque ya corrió contra `dev` (y va a correr contra
-- `prod`) — editar una migración ya aplicada no la vuelve a ejecutar
-- (`node-pg-migrate` la sigue viendo como aplicada en `pgmigrations`), así
-- que el cambio real tiene que ser una migración nueva.
--
-- Los 4 RUC son de 11 dígitos (formato estándar de persona jurídica en
-- Perú, prefijo "20"), confirmados directamente por Jorge:
--   CHANCAYLLO -> 20612016527
--   MALA       -> 20605858601
--   ANDAHUASI  -> 20612024821
--   PACHACUTEC -> 20609785269
--
-- `UPDATE` en vez de `INSERT ... ON CONFLICT`: las 4 filas ya existen (las
-- crea la migración anterior) — acá solo se completa una columna. Es
-- naturalmente idempotente (correrlo dos veces deja el mismo valor), y de
-- todas formas `node-pg-migrate` no la vuelve a correr una vez aplicada.

-- Up Migration

UPDATE estaciones SET ruc = '20612016527' WHERE codigo = 'CHANCAYLLO';
UPDATE estaciones SET ruc = '20605858601' WHERE codigo = 'MALA';
UPDATE estaciones SET ruc = '20612024821' WHERE codigo = 'ANDAHUASI';
UPDATE estaciones SET ruc = '20609785269' WHERE codigo = 'PACHACUTEC';

-- Down Migration

UPDATE estaciones SET ruc = NULL WHERE codigo IN ('CHANCAYLLO', 'MALA', 'ANDAHUASI', 'PACHACUTEC');
