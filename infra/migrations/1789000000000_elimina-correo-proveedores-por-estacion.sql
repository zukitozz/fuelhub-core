-- 1789000000000_elimina-correo-proveedores-por-estacion.sql
--
-- Revierte 1788800000000/1788900000000 -- hallazgo real de Jorge (v1.84):
-- `estaciones_correo_proveedores` se leía en Aurora INCONDICIONALMENTE en
-- cada corrida del cron de `ingest-compra-correo` (cada 30 min en prod),
-- ANTES de siquiera mirar Gmail -- como Aurora Serverless v2 está en
-- `minCapacity 0`, cada corrida pagaba el costo completo de "despertarla"
-- solo para leer una tabla de 4 filas que casi nunca cambia, tenga o no
-- correo nuevo que procesar.
--
-- Esa config pasa a vivir en código versionado
-- (`services/ingest-compra-correo/src/config/estacionesCorreoProveedores.ts`)
-- -- es puramente administrativa (la decide y carga Jorge a mano, nunca la
-- escribe ningún flujo de negocio), así que no pierde su garantía real
-- (Jorge sigue siendo quien decide el contenido) por dejar de estar en
-- Postgres. El contenido real de esta tabla (4 estaciones, mismo buzón,
-- sin etiqueta) se copió al archivo nuevo ANTES de correr esta migración
-- -- ver su comentario de cabecera.
--
-- Down Migration recrea la tabla vacía (mismo shape que 1788800000000 +
-- 1788900000000 ya aplicadas) pero NO reinserta las filas -- si hay que
-- revertir de verdad, hace falta cargarlas de nuevo a mano (mismo criterio
-- que la migración original, que tampoco traía seed).

-- Up Migration

DROP TABLE IF EXISTS estaciones_correo_proveedores;

-- Down Migration

CREATE TABLE estaciones_correo_proveedores (
  estacion_id UUID PRIMARY KEY REFERENCES estaciones(id),
  nombre_secreto_gmail VARCHAR(255) NOT NULL,
  etiqueta_gmail VARCHAR(100),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
