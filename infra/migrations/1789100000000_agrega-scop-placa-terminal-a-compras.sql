-- 1789100000000_agrega-scop-placa-terminal-a-compras.sql
--
-- v1.87 -- Jorge pidió guardar datos regulatorios de la factura de
-- combustible que confirmamos que SÍ vienen en el XML, cruzando 5 facturas
-- reales de PETROPERU contra el reglamento oficial de SUNAT (Resolución
-- 245-2017, Anexo B):
--
--   - numero_autorizacion_scop: el código de autorización del Sistema de
--     Control de Órdenes de Pedido (SCOP, Resolución OSINERG N.° 048-2003-
--     OS/CD) -- CAMPO ESTÁNDAR de UBL 2.1 (`AdditionalDocumentReference/ID`,
--     "campo 31" del anexo), no parte de la extensión propietaria. Columna
--     A de la planilla de Jorge ("Código Autorización").
--   - placa: también estándar (`TransportMeans/RoadTransport/LicensePlateID`).
--   - terminal_abastecimiento: SOLO está en la extensión propietaria
--     `DatosAdicionales` (código 21, no forma parte del estándar UBL) --
--     confianza empírica (5/5 facturas reales), no respaldada por el
--     reglamento oficial como los dos anteriores.
--
-- Las 3 nullable -- una compra manual (POST /compras) nunca las trae, y un
-- proveedor que no sea PETROPERU/no use este mismo PSE podría no traer
-- alguna (sobre todo terminal_abastecimiento, que ni siquiera es estándar).
-- Sin índice: son datos informativos, no se filtra/busca por ellos todavía.

-- Up Migration

ALTER TABLE compras
  ADD COLUMN numero_autorizacion_scop VARCHAR(30),
  ADD COLUMN placa VARCHAR(20),
  ADD COLUMN terminal_abastecimiento VARCHAR(150);

-- Down Migration

ALTER TABLE compras
  DROP COLUMN IF EXISTS numero_autorizacion_scop,
  DROP COLUMN IF EXISTS placa,
  DROP COLUMN IF EXISTS terminal_abastecimiento;
