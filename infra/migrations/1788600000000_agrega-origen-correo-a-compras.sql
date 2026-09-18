-- 1788600000000_agrega-origen-correo-a-compras.sql
--
-- Prepara `compras` para la nueva capacidad de lectura de correos de
-- proveedores (a pedido de Jorge): un Lambda nuevo, disparado por cron, va
-- a leer facturas electrónicas (PDF+XML) que llegan a un buzón de Gmail
-- compartido del grupo, y registrar la compra automáticamente -- sin que
-- nadie la digite a mano. Tres cambios, los tres pensados para que
-- `POST /compras`/`PUT /compras/{id}` (flujo manual existente, sin cambios
-- de comportamiento) y el flujo nuevo por correo convivan en la misma
-- tabla sin pisarse:
--
-- 1. `origen` (NOT NULL, DEFAULT 'MANUAL'): distingue una compra digitada a
--    mano de una creada por el Lambda de correo (`CORREO`). Solo
--    informativo por ahora (filtros/auditoría) -- no cambia ninguna regla
--    de negocio existente.
--
-- 2. `estado` deja de compartir el ENUM `estado_cierre` (el mismo que usan
--    `cierres_dia`/`cierres_turno`, sección 3.3) y pasa a su propio tipo,
--    `estado_compra`, con un tercer valor: `PENDIENTE_REVISION`. Es el
--    estado en el que cae una compra leída por correo cuando el Lambda no
--    tiene confianza suficiente en el dato extraído (p. ej. no pudo
--    matchear la descripción del ítem contra `productos_maestro`) -- queda
--    visible por `GET /compras?estado=PENDIENTE_REVISION` para que Jorge
--    la revise/corrija con el mismo `PUT /compras/{id}` que ya existe
--    (editar campos + pasar `estado` a `ACTIVO` para confirmarla, mismo
--    criterio que ya usa ese endpoint para anular), sin necesitar un
--    endpoint de confirmación dedicado. No se agrega `PENDIENTE_REVISION`
--    al ENUM compartido `estado_cierre` a propósito -- ese concepto no
--    tiene sentido para un cierre de turno/día (siempre nace `ACTIVO`, sin
--    revisión previa), así que ensanchar un tipo compartido por 3 tablas
--    para una necesidad de una sola habría sido una fuga de concepto.
--    `cierres_dia`/`cierres_turno` NO se tocan en esta migración.
--
-- 3. `proveedor_ruc`/`numero_comprobante` (ambos nullable -- una compra
--    manual, sin factura electrónica detrás, no siempre los tiene): la
--    combinación es el identificador natural de una factura electrónica
--    peruana (único por proveedor, garantizado por SUNAT), y es la
--    verdadera defensa contra duplicados del Lambda de correo -- más
--    confiable que cualquier estado que se lleve del lado de Gmail
--    (etiquetas), que es solo una optimización para no releer el mismo
--    correo en cada corrida. Antes de registrar una compra desde un
--    correo, el caso de uso nuevo va a verificar que este par no exista
--    todavía; el índice único (parcial, solo cuando ambos vienen
--    informados) hace que la base de datos lo garantice también, no solo
--    el código de aplicación.

-- Up Migration

CREATE TYPE estado_compra AS ENUM ('ACTIVO', 'ANULADO', 'PENDIENTE_REVISION');

ALTER TABLE compras
  ALTER COLUMN estado DROP DEFAULT;

ALTER TABLE compras
  ALTER COLUMN estado TYPE estado_compra USING estado::text::estado_compra;

ALTER TABLE compras
  ALTER COLUMN estado SET DEFAULT 'ACTIVO';

ALTER TABLE compras
  ADD COLUMN origen             VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN proveedor_ruc      VARCHAR(11),
  ADD COLUMN numero_comprobante VARCHAR(20);

ALTER TABLE compras
  ADD CONSTRAINT chk_compras_origen CHECK (origen IN ('MANUAL', 'CORREO'));

CREATE UNIQUE INDEX ux_compras_proveedor_comprobante
  ON compras (proveedor_ruc, numero_comprobante)
  WHERE proveedor_ruc IS NOT NULL AND numero_comprobante IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS ux_compras_proveedor_comprobante;

ALTER TABLE compras
  DROP CONSTRAINT IF EXISTS chk_compras_origen;

ALTER TABLE compras
  DROP COLUMN IF EXISTS numero_comprobante,
  DROP COLUMN IF EXISTS proveedor_ruc,
  DROP COLUMN IF EXISTS origen;

ALTER TABLE compras
  ALTER COLUMN estado DROP DEFAULT;

ALTER TABLE compras
  ALTER COLUMN estado TYPE estado_cierre USING estado::text::estado_cierre;

ALTER TABLE compras
  ALTER COLUMN estado SET DEFAULT 'ACTIVO';

DROP TYPE IF EXISTS estado_compra;
