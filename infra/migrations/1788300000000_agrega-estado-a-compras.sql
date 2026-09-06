-- 1788300000000_agrega-estado-a-compras.sql
--
-- Agrega `compras.estado` (v1.66), a pedido de Jorge: hasta esta migración
-- no había forma de anular una compra registrada por error -- solo se podía
-- crear (`POST /compras`), nunca corregir ni invalidar. Se reutiliza el
-- ENUM `estado_cierre` (`ACTIVO`/`ANULADO`) que ya existe desde la
-- migración inicial para `cierres_dia`/`cierres_turno` -- mismo significado
-- (registro inválido, se conserva para auditoría, no cuenta para
-- reportes/stock), no hace falta un tipo nuevo.
--
-- A diferencia de `cierres_dia`/`cierres_turno`, esta es la PRIMERA vez en
-- todo el repo que se construye un endpoint que en verdad transiciona
-- ACTIVO -> ANULADO (ningún Lambda existente lo hacía -- `estado` en
-- cierres solo se lee/filtra, nunca se escribe fuera del INSERT inicial).
-- Se decidió no introducir un endpoint de acción dedicado
-- (`POST /compras/{id}/anular`) sino tratar `estado` como un campo más
-- editable en `PUT /compras/{id}` (mismo criterio que `PUT /tanques/{id}`
-- ya usa para `activo`, sección 3.8.3) -- ver `CompraUpdateInput.ts`.
--
-- `DEFAULT 'ACTIVO'` deja las compras ya existentes correctamente
-- clasificadas sin necesitar un UPDATE aparte (igual criterio que
-- `productos_maestro.categoria` en la migración de v1.58).
--
-- Las consultas reales que agregan sobre `compras` para negocio (margen
-- estimado y frecuencia de abastecimiento, sección 3.8.2 b/c) se actualizan
-- en el mismo commit para filtrar `estado = 'ACTIVO'` -- sin este cambio,
-- una compra anulada seguiría contando en el costo promedio ponderado y en
-- la frecuencia real de compra, que es justo lo que anular una compra
-- debería evitar.

-- Up Migration

ALTER TABLE compras
  ADD COLUMN estado estado_cierre NOT NULL DEFAULT 'ACTIVO';

CREATE INDEX ix_compras_estado ON compras (estado);

-- Down Migration

ALTER TABLE compras DROP COLUMN estado;
