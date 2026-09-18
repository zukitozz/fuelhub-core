-- 1788800000000_agrega-correo-proveedores-por-estacion.sql
--
-- Multiempresa real (v1.82): hasta ahora `ingest-compra-correo` asumía UN
-- solo buzón de Gmail compartido por todo el grupo (`grupoId`), con la
-- etiqueta de origen fija en código (`FuelHub/Proveedores`,
-- `GmailFacturaProveedorSource.ts`). Confirmado con Jorge: cada una de las
-- 4 estaciones reales de "nonato" es su propia razón social -- así que el
-- buzón (y quién puede tener acceso a leerlo) debería poder matricularse
-- por estación, no asumirse compartido para siempre. Confirmado también
-- que DOS estaciones podrían compartir el mismo buzón físico de Gmail,
-- diferenciándose solo por la etiqueta -- por eso esta tabla guarda el
-- nombre del secreto Y la etiqueta por separado, en vez de derivar uno del
-- otro por convención de nombres (lo que forzaría "1 secreto = 1
-- estación", más rígido de lo que Jorge pidió).
--
-- `estacion_id` es la llave primaria (no una `id` propia) -- modela a
-- propósito una relación 1:1 con `estaciones` (confirmado con Jorge: 1 fila
-- por estación, no una entidad "empresa" aparte todavía -- ver conversación
-- de diseño). Si una estación no tiene fila acá, simplemente no se lee
-- ningún correo para ella -- no hace falta un flag "sin configurar", la
-- ausencia de fila ya lo dice.
--
-- `nombre_secreto_gmail` guarda el NOMBRE (no el ARN, no las credenciales)
-- del secreto en Secrets Manager -- creado corriendo
-- `scripts/gmail-oauth-setup.mjs --buzon <slug>` (ver esa actualización del
-- script, v1.82). Dos estaciones que comparten buzón simplemente repiten el
-- mismo valor acá. `GetSecretValueCommand` de AWS acepta el nombre
-- directamente como `SecretId` -- no hace falta resolver el ARN completo en
-- ningún lado del código.
--
-- `etiqueta_gmail` reemplaza la constante `ETIQUETA_ORIGEN` que antes vivía
-- fija en `GmailFacturaProveedorSource.ts` -- default
-- 'FuelHub/Proveedores' para no romper la convención ya usada, pero cada
-- estación puede tener la suya (ej. 'FuelHub/Proveedores-Chancayllo') si
-- comparte buzón con otra.
--
-- `activo`: para poder pausar la lectura de correo de UNA estación sin
-- borrar su fila (ej. mientras se resuelve un problema de acceso al buzón),
-- mismo criterio que `tanques.activo`/`productos_maestro` en el resto del
-- esquema.
--
-- Sin seed acá -- Jorge decide y carga las filas reales a mano (o me pide
-- que arme el INSERT) una vez que tenga decidido qué estaciones comparten
-- buzón y cuáles no; no hay un valor por defecto razonable que adivinar.

-- Up Migration

CREATE TABLE estaciones_correo_proveedores (
  estacion_id UUID PRIMARY KEY REFERENCES estaciones(id),
  nombre_secreto_gmail VARCHAR(255) NOT NULL,
  etiqueta_gmail VARCHAR(100) NOT NULL DEFAULT 'FuelHub/Proveedores',
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS estaciones_correo_proveedores;
