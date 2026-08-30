-- 1787940000000_seed-estacion-smoketest.sql
--
-- Estación FALSA dedicada solo al smoke-test del pipeline (12.3/12.5, v1.52)
-- -- código `SMOKETEST`, nunca una de las 4 estaciones reales del grupo
-- "nonato" (CHANCAYLLO/MALA/ANDAHUASI/PACHACUTEC).
--
-- Por qué existe esta fila, decisión tomada con Jorge al escribir
-- `scripts/smoke-test.mjs`: el script registra un cierre de turno sintético
-- en CADA despliegue (dev y prod), usando el código de estación que traiga
-- el token del App Client de pruebas (`custom:station_scope` del JWT, ver
-- 5.2/9.2.2). Si ese App Client estuviera scopeado a una estación real, esos
-- cierres falsos quedarían mezclados para siempre con los datos reales de
-- esa estación, en dev Y en producción (el mismo User Pool sirve para los 2
-- ambientes, ver `auth-stack.ts`) -- un riesgo real para cualquier reporte o
-- reconciliación que no se acuerde de filtrar por el prefijo `ci-smoke-test`.
-- Con esta fila, el App Client de pruebas se scopea a `station.SMOKETEST`
-- (scope nuevo, a crear a mano en el Resource Server de Cognito -- mismo
-- checklist de 9.2.1) y los cierres de prueba quedan en su propio espacio,
-- sin tocar nunca los números reales de ninguna estación.
--
-- `activo = true` (default) a propósito: el smoke-test usa `AND activo =
-- true` para resolver la estación (`resolverEstacion`, mismo criterio que
-- cualquier estación real) -- si se desactivara, el smoke-test fallaría con
-- "codigoEstacion no reconocido" en vez de con un error claro.
--
-- `ruc`/`emisor_id_legacy` quedan NULL -- no es una E.I.R.L. real, no
-- factura, no tiene legado en el sistema anterior.
--
-- No necesita fila en `tanques`: el detalle sintético del smoke-test usa
-- `codigoLocal` (no `productoId`, sección 3.8.1.1), así que nunca pasa por
-- la validación de tanques/catálogo cruzado.
--
-- `ON CONFLICT (codigo) DO NOTHING` -- mismo criterio de idempotencia que
-- el resto de los seeds de este directorio.

-- Up Migration

INSERT INTO estaciones (codigo, nombre, ruc) VALUES
    ('SMOKETEST', 'ESTACION DE PRUEBAS (CI/CD) - NO ES UNA ESTACION REAL', NULL)
ON CONFLICT (codigo) DO NOTHING;

-- Down Migration

DELETE FROM estaciones WHERE codigo = 'SMOKETEST';
