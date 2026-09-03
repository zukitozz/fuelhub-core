-- 1788000000000_agrega-categoria-producto.sql
--
-- Clasificación combustible/no-combustible (sección 3.8.1/3.8.2, changelog
-- v1.57/v1.58) — la necesita el endpoint `GET /v1/reportes/dia` que consume
-- `notificaciones-whatsapp` (contrato externo, sección 2.2 de ese documento):
-- exige separar `totalCombustible` de `totalNoCombustible`, y hasta esta
-- migración el modelo no tenía ninguna columna para eso. Se descartó a
-- propósito el heurístico "productoId IS NOT NULL ⇒ combustible" (funciona
-- hoy porque los 5 productos del catálogo cruzado son todos combustibles,
-- pero es un supuesto implícito y frágil) — decisión explícita de Jorge:
-- columna de categoría real, no heurístico.
--
-- Dos columnas nuevas, tipo `categoria_producto` (ENUM, mismo patrón que
-- `estado_cierre`/`turno_enum` de la migración inicial — sección 3.3):
--
--   1. `productos_maestro.categoria` — NOT NULL DEFAULT 'COMBUSTIBLE'. Los 5
--      productos del catálogo cruzado (Diésel/Premium/Regular/GLP/GNV) son
--      TODOS combustibles hoy (sección 3.8.1) — el DEFAULT deja las 5 filas
--      existentes correctamente clasificadas sin necesitar un UPDATE aparte,
--      y a la vez deja la puerta abierta a que, si algún día se agrega un
--      producto no-combustible al catálogo cruzado (poco probable dado el
--      propósito del catálogo, pero no imposible), se declare explícito con
--      'NO_COMBUSTIBLE' en su propio INSERT en vez de heredar un default
--      equivocado.
--
--   2. `cierres_turno_detalle.categoria` — NULLABLE, SIN default. Cubre las
--      líneas que NO usan el catálogo cruzado (balón de gas, urea, panetón,
--      etc. — identificadas solo por `codigoLocal`, sección 3.8.1.1): para
--      esas líneas no hay ningún catálogo del que heredar la categoría, así
--      que depende de que la estación la mande explícita en el payload
--      (`DetalleLineaInput.categoria`, nuevo campo OPCIONAL — ver
--      `CierreTurnoInput.ts`/`openapi.yaml`). Deliberadamente NO se hace
--      obligatorio en el contrato todavía: ya hay integradores reales
--      probando contra `dev` (changelog v1.53/v1.54) y este documento no
--      coordina directamente con ellos — hacerlo obligatorio de un día para
--      el otro rompería sus requests actuales. Las filas ya insertadas y las
--      líneas nuevas sin este dato quedan en NULL ("sin clasificar"), no en
--      un valor adivinado — `/v1/reportes/dia` deberá decidir cómo mostrar
--      ese caso (fuera de alcance de esta migración, ver changelog v1.58).
--
-- Para líneas CON `productoId`, el servidor resuelve la categoría desde
-- `productos_maestro` e ignora cualquier `categoria` que el cliente mande en
-- esa línea (el catálogo es la fuente de verdad ahí) — lógica en
-- `PostgresCierreTurnoIngestaRepository.ts`, no en esta migración.

-- Up Migration

CREATE TYPE categoria_producto AS ENUM ('COMBUSTIBLE', 'NO_COMBUSTIBLE');

ALTER TABLE productos_maestro
  ADD COLUMN categoria categoria_producto NOT NULL DEFAULT 'COMBUSTIBLE';

ALTER TABLE cierres_turno_detalle
  ADD COLUMN categoria categoria_producto;

-- Down Migration

ALTER TABLE cierres_turno_detalle DROP COLUMN categoria;
ALTER TABLE productos_maestro DROP COLUMN categoria;
DROP TYPE categoria_producto;
