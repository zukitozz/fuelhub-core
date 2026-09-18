-- 1788700000000_agrega-numero-linea-a-compras.sql
--
-- Corrige el índice único que agregó 1788600000000_agrega-origen-correo-a-compras.sql
-- antes de que el Lambda de lectura de correos empiece a escribir contra él.
--
-- Esa migración asumía una fila de `compras` por comprobante entero
-- (`UNIQUE (proveedor_ruc, numero_comprobante)`). Confirmado con Jorge: hoy
-- toda factura real de proveedor trae un solo producto, PERO hay que estar
-- preparados para que una misma factura traiga varios productos --
-- combustibles y no combustibles -- en líneas distintas (una guía con
-- diésel + regular, por ejemplo). El caso de uso nuevo (`ProcesarFactura-
-- ProveedorCorreo`, por construir) va a insertar UNA fila de `compras` por
-- cada `InvoiceLine` del XML (mismo criterio que ya usa el flujo manual:
-- una compra = un producto), así que el índice único tal como estaba
-- habría rechazado la SEGUNDA línea de cualquier factura futura con 2+
-- productos como si fuera un duplicado -- un bug de idempotencia real,
-- encontrado antes de escribir una sola línea de ese código gracias a que
-- Jorge lo señaló al planear esta capacidad.
--
-- `numero_linea_comprobante` (VARCHAR(10), nullable -- igual que
-- `proveedor_ruc`/`numero_comprobante`, una compra manual no tiene ninguno
-- de los tres) guarda el número de línea del XML (`cbc:ID` dentro de cada
-- `InvoiceLine`, ej. "1", "2" -- `FacturaProveedorXml.ts` ya lo expone como
-- `item.numeroLinea`, con fallback al índice 1-based si el proveedor no lo
-- manda, aunque UBL 2.1 lo exige siempre). El índice único ahora es sobre
-- los TRES campos juntos: sigue bloqueando releer la MISMA línea de la
-- MISMA factura dos veces (el caso real que importa -- reprocesar un correo
-- por un reintento/etiqueta desincronizada), pero ya no bloquea que una
-- factura con 2+ productos registre una fila por cada uno.
--
-- La condición del índice parcial (`WHERE ... IS NOT NULL`) se extiende
-- igual a los tres campos -- una compra manual (los tres en NULL) nunca
-- participa de esta unicidad, mismo criterio que la migración anterior.

-- Up Migration

DROP INDEX IF EXISTS ux_compras_proveedor_comprobante;

ALTER TABLE compras
  ADD COLUMN numero_linea_comprobante VARCHAR(10);

CREATE UNIQUE INDEX ux_compras_proveedor_comprobante_linea
  ON compras (proveedor_ruc, numero_comprobante, numero_linea_comprobante)
  WHERE proveedor_ruc IS NOT NULL AND numero_comprobante IS NOT NULL AND numero_linea_comprobante IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS ux_compras_proveedor_comprobante_linea;

ALTER TABLE compras
  DROP COLUMN IF EXISTS numero_linea_comprobante;

CREATE UNIQUE INDEX ux_compras_proveedor_comprobante
  ON compras (proveedor_ruc, numero_comprobante)
  WHERE proveedor_ruc IS NOT NULL AND numero_comprobante IS NOT NULL;
