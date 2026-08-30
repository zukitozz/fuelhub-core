-- 1787920000000_seed-estaciones-nonato.sql
--
-- Carga las 4 filas de `estaciones` (sección 3.3) del grupo "nonato" —
-- CHANCAYLLO, MALA, ANDAHUASI, PACHACUTEC. Faltaba: 13.3 (Fase 4, punto 2)
-- la describe como un paso manual ("insertar las filas de estaciones del
-- grupo nuevo"), y nunca se había escrito como migración real porque hasta
-- v1.50 nunca hubo un despliegue real contra el que correrla. Se descubre
-- este hueco al preparar `test:integration` (12.6): sin esta migración,
-- `1787936588638_seed-tanques.sql` (que ya corre después, por timestamp)
-- inserta CERO filas en silencio — su `INSERT ... SELECT ... WHERE e.codigo
-- = 'PACHACUTEC'` simplemente no matchea nada, sin error — y cualquier
-- intento de ingesta real fallaría por `codigoEstacion no reconocido`
-- (`PostgresCierreTurnoIngestaRepository.resolverEstacion`, etc.).
--
-- `nombre` = razón social real de cada E.I.R.L., ya confirmada y en la
-- spec desde antes (sección 9.2.1, tabla de App Clients) — no es dato
-- nuevo de esta migración, solo la primera vez que se persiste en
-- `estaciones.nombre` en vez de vivir solo en el documento.
--
-- `ruc` queda en NULL a propósito: la sección 9.2.1 (nota al pie de la
-- tabla) ya dejaba anotado que el RUC de cada E.I.R.L. "aún no compartido"
-- — no se inventa un valor. Se puede completar con un `UPDATE` aparte
-- (no hace falta re-correr esta migración) en cuanto Jorge lo confirme.
--
-- Timestamp elegido para correr DESPUÉS de esquema-inicial (1787900000000,
-- necesita que la tabla exista) y ANTES de seed-productos-maestro/
-- seed-tanques (1787936588637/638) — sin dependencia real con productos,
-- pero tanques sí depende de que estas 4 filas ya existan.
--
-- `ON CONFLICT (codigo) DO NOTHING` — mismo criterio de idempotencia que
-- el resto de los seeds de este directorio (seguro de reintentar).

-- Up Migration

INSERT INTO estaciones (codigo, nombre, ruc) VALUES
    ('CHANCAYLLO', 'GRUPO NONATO CHANCAYLLO E.I.R.L.',  NULL),
    ('MALA',       'GRUPO EMPRESARIAL NONATO E.I.R.L.', NULL),
    ('ANDAHUASI',  'GRUPO NONATO ANDAHUASI E.I.R.L.',   NULL),
    ('PACHACUTEC', 'SIRCON PACHACUTEC E.I.R.L.',        NULL)
ON CONFLICT (codigo) DO NOTHING;

-- Down Migration

DELETE FROM estaciones WHERE codigo IN ('CHANCAYLLO', 'MALA', 'ANDAHUASI', 'PACHACUTEC');
