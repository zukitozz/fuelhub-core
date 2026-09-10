-- 1788400000000_agrega-entregas-externas-compras.sql
--
-- Extiende compras_abastecimientos (migracion 1788200000000) para cubrir un
-- caso real que Jorge describio: una compra no siempre se reparte solo a
-- tanques del grupo -- tambien puede "revenderse"/entregarse a terceros
-- fuera de los grifos registrados (venta al menudeo a granel, con mangueras
-- propias de algunos vehiculos), y puede haber VARIAS entregas externas por
-- compra, no solo una. Jorge fue explicito: no quiere un sistema de ventas
-- para esos clientes, solo registrar donde entrego el producto que compro.
-- Aplica igual para compras de combustible y de mercaderia (categoria) --
-- destinos/categoria ya eran independientes desde 1788200000000.
--
-- Decision de diseno (confirmada con Jorge): sin catalogo de clientes --
-- cada entrega externa se anota con texto libre (descripcion_entrega), no
-- una referencia a una tabla de clientes.
--
-- Cambio de esquema: tanque_id pasa a NULLABLE (dejaba de ser siempre un
-- tanque registrado) y se agrega descripcion_entrega (texto libre). Un
-- CHECK exige EXACTAMENTE UNO de los dos presentes por fila -- nunca ambos
-- (ambiguo: ¿a un tanque o afuera?), nunca ninguno (una fila sin destino no
-- significa nada).
--
-- La formula de merma (compras.cantidad - SUM(compras_abastecimientos.cantidad))
-- NO cambia -- sigue siendo 100% derivada, ver nota de cabecera de
-- 1788200000000. Con este cambio es MAS precisa: una entrega externa ahora
-- cuenta en esa suma igual que un tanque, asi que "merma" vuelve a
-- significar perdida sin explicar, no "todo lo que no fue a un tanque
-- propio del grupo".
--
-- Sin filas existentes con tanque_id NULL antes de esta migracion (todas las
-- filas de compras_abastecimientos hasta ahora vienen de tanques reales,
-- backfill de 1788200000000 incluido) -- el CHECK se puede agregar
-- directamente, sin necesidad de limpiar datos primero.

-- Up Migration

ALTER TABLE compras_abastecimientos
  ALTER COLUMN tanque_id DROP NOT NULL,
  ADD COLUMN descripcion_entrega TEXT,
  ADD CONSTRAINT ck_compras_abastecimientos_destino_xor
    CHECK ((tanque_id IS NOT NULL) <> (descripcion_entrega IS NOT NULL));

-- Down Migration
--
-- ALTER COLUMN tanque_id SET NOT NULL falla si ya existen filas de
-- entregas externas (tanque_id NULL) creadas despues de este Up -- mismo
-- criterio que el resto del repo: el down asume que se corre antes de
-- que la funcionalidad nueva se use en produccion, no despues.

ALTER TABLE compras_abastecimientos
  DROP CONSTRAINT IF EXISTS ck_compras_abastecimientos_destino_xor,
  DROP COLUMN IF EXISTS descripcion_entrega,
  ALTER COLUMN tanque_id SET NOT NULL;
