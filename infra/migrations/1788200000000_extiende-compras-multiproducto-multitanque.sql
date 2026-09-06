-- 1788200000000_extiende-compras-multiproducto-multitanque.sql
--
-- Extiende `compras` para dos casos reales que Jorge describió y que el
-- modelo de v1.0 (sección 3.8) no cubría (changelog v1.65):
--
--   1. Compras que NO son de combustible (mercadería de tienda: galletas,
--      panetón, etc.). Hasta esta migración, `compras.producto_id` era
--      SIEMPRE obligatorio (a diferencia de `cierres_turno_detalle`, que ya
--      desde v1.7 admite ventas fuera del catálogo cruzado) — la
--      justificación de esa época ("compras y tanques son conceptos
--      exclusivos de combustible", sección 3.8.1) deja de ser cierta: Jorge
--      también compra cosas para vender en el mercadito de cada estación,
--      que nunca van a estar en `productos_maestro` (catálogo cruzado
--      pensado para combustibles estandarizados entre estaciones, 5 filas).
--      Se resuelve con el MISMO patrón que ya existe en
--      `cierres_turno_detalle` desde v1.7/v1.58: `producto_id` pasa a
--      opcional, y se agregan `producto_nombre` (identidad de texto libre
--      cuando no hay catálogo) y `categoria` (clasificación explícita
--      cuando no hay catálogo del que heredarla). Decisión explícita de
--      Jorge: sin catálogo intermedio para mercadería (texto libre).
--
--   2. Una compra de combustible facturada a nombre de UNA estación (una
--      compra siempre corresponde a un único RUC/factura, y cada RUC es de
--      una sola estación — confirmado por Jorge) puede, por contingencia,
--      repartirse físicamente entre varios tanques — incluso tanques de
--      OTRA estación distinta a la que compró. El modelo anterior solo
--      admitía un `tanque_id` por compra (relación 1 a 1), que no puede
--      representar ese reparto. Se agrega `compras_abastecimientos`, tabla
--      hija (mismo patrón cabecera/detalle que `cierres_turno`/
--      `cierres_turno_detalle`, sección 3.3): cada fila es "esta compra
--      mandó tanta cantidad a este tanque", sin restricción de que el
--      tanque sea de la misma estación que la compra.
--
--      La suma de lo repartido a tanques puede ser MENOR a `compras.cantidad`
--      — la diferencia es MERMA real (confirmado con Jorge: pérdida de
--      combustible en el trayecto/manipulación, no un error de datos). No se
--      guarda como columna aparte porque es 100% derivable:
--      `merma = compras.cantidad - SUM(compras_abastecimientos.cantidad)`
--      de esa compra. Nunca puede ser MAYOR — no se puede repartir a
--      tanques más de lo que se compró (validado en la aplicación, ver
--      `CompraInput.ts`/`PostgresCompraIngestaRepository.ts`).
--
-- `compras.tanque_id` (columna existente desde la migración inicial) queda
-- en la tabla pero DEPRECADA: de acá en adelante la aplicación ya no la usa
-- para escribir (el reparto a tanques vive solo en la tabla nueva, incluso
-- para el caso normal de un único tanque) — se deja sin tocar para no
-- romper ninguna fila/consulta histórica que ya la use. Las filas que ya
-- existían con `tanque_id` se migran (backfill abajo) a
-- `compras_abastecimientos`, para que el cálculo de stock/merma funcione
-- igual de bien con compras viejas y nuevas, sin distinguir casos.
--
-- Sin consumidores reales de `POST /compras` todavía (confirmado con Jorge)
-- — el cambio de contrato (`tanqueId` suelto → `destinos[]`, ver
-- `openapi.yaml`/`CompraInput.ts`) no rompe ninguna integración existente.

-- Up Migration

ALTER TABLE compras
  ALTER COLUMN producto_id DROP NOT NULL,
  ADD COLUMN producto_nombre VARCHAR(255),
  ADD COLUMN categoria categoria_producto;

-- Backfill de producto_nombre para las filas ya existentes (todas con
-- producto_id de catálogo, ya que hasta ahora era obligatorio) — toma el
-- nombre vigente del catálogo. Después de esto, la columna pasa a NOT NULL,
-- mismo criterio que `cierres_turno_detalle.producto_nombre` (sección 3.3):
-- toda compra tiene un nombre de producto, venga o no del catálogo cruzado.
UPDATE compras c
SET producto_nombre = pm.nombre
FROM productos_maestro pm
WHERE c.producto_id = pm.id
  AND c.producto_nombre IS NULL;

ALTER TABLE compras ALTER COLUMN producto_nombre SET NOT NULL;

CREATE TABLE compras_abastecimientos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compra_id   UUID NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    tanque_id   UUID NOT NULL REFERENCES tanques(id),
    cantidad    NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_compras_abastecimientos_compra ON compras_abastecimientos (compra_id);
CREATE INDEX ix_compras_abastecimientos_tanque ON compras_abastecimientos (tanque_id);

-- Backfill: compras viejas con tanque_id single -> una fila en la tabla nueva.
INSERT INTO compras_abastecimientos (compra_id, tanque_id, cantidad)
SELECT id, tanque_id, cantidad
FROM compras
WHERE tanque_id IS NOT NULL;

-- Down Migration

DROP TABLE IF EXISTS compras_abastecimientos;

ALTER TABLE compras
  ALTER COLUMN producto_nombre DROP NOT NULL,
  DROP COLUMN IF EXISTS categoria,
  DROP COLUMN IF EXISTS producto_nombre,
  ALTER COLUMN producto_id SET NOT NULL;
