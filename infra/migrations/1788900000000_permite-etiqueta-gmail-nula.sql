-- 1788900000000_permite-etiqueta-gmail-nula.sql
--
-- Jorge va a crear un buzón de Gmail NUEVO y dedicado exclusivamente a
-- recibir facturas de proveedores -- a diferencia del buzón compartido de
-- hoy (donde SÍ hace falta una etiqueta para separar "esto es una
-- factura" del resto del correo), en ese buzón dedicado TODO lo que
-- llegue (que no esté ya `FuelHub/Procesado`/`FuelHub/Error`) debería
-- entrar como candidato a compra -- exigirle una etiqueta ahí sería un
-- paso manual de más sin ningún propósito (preguntado directo: "Hay
-- alguna manera de que no lea por etiqueta?").
--
-- `etiqueta_gmail` pasa a ser NULLABLE: NULL significa "no filtrar por
-- etiqueta de origen -- sondear TODO el buzón" (`GmailFacturaProveedor-
-- Source.ts` arma el query de Gmail con solo las exclusiones
-- `-label:FuelHub/Procesado -label:FuelHub/Error` cuando es NULL, sin el
-- término positivo `label:X`). Un string (como hasta ahora) sigue
-- filtrando por esa etiqueta puntual -- el comportamiento de las 4
-- estaciones ya matriculadas con buzón compartido NO cambia.
--
-- Se quita también el DEFAULT 'FuelHub/Proveedores': de acá en adelante
-- cada fila nueva tiene que decidir explícitamente si filtra por etiqueta
-- o no -- un default silencioso ya no tiene sentido cuando las dos
-- opciones son válidas y muy distintas en efecto (buzón compartido entre
-- varias estaciones vs. buzón dedicado a una sola). Las filas que ya
-- existen conservan el valor que tengan (no se tocan).
--
-- OJO si dos+ estaciones algún día comparten un buzón SIN etiqueta (NULL)
-- cada una: `handler.ts` las deduplica por (secreto, etiqueta) -- dos NULL
-- para el mismo secreto colapsan en una sola pasada, lo cual es correcto
-- (sondear el mismo buzón completo dos veces sería redundante), pero la
-- atribución de a qué estación pertenece cada compra sigue viniendo del
-- RUC del receptor en el XML (`ProcesarFacturaProveedorCorreo`), no de la
-- etiqueta -- mismo criterio de seguridad que ya documenta la migración
-- 1788800000000.

-- Up Migration

ALTER TABLE estaciones_correo_proveedores
  ALTER COLUMN etiqueta_gmail DROP DEFAULT;

ALTER TABLE estaciones_correo_proveedores
  ALTER COLUMN etiqueta_gmail DROP NOT NULL;

-- Down Migration

UPDATE estaciones_correo_proveedores
  SET etiqueta_gmail = 'FuelHub/Proveedores'
  WHERE etiqueta_gmail IS NULL;

ALTER TABLE estaciones_correo_proveedores
  ALTER COLUMN etiqueta_gmail SET NOT NULL;

ALTER TABLE estaciones_correo_proveedores
  ALTER COLUMN etiqueta_gmail SET DEFAULT 'FuelHub/Proveedores';
