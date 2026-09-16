// domain/DocumentoReporteKey.ts
//
// v1.78 -- construye las keys ESTABLES (no timestamped) de S3 para los PDFs
// de reporte de día, ahora que se generan una sola vez al recibir el cierre
// de día (`GenerarReporteDiaDocumento`, disparado por el evento
// `CierreDiaRegistrado`) en vez de en cada `GET /reportes/dia/documento`.
// Antes (v1.60-v1.77) la key llevaba `Date.now()` porque se regeneraba en
// cada request y nunca se reutilizaba (`reportes-dia/{fecha}/{estacion}-
// {timestamp}.pdf`); ahora tiene que ser la MISMA key tanto quien la escribe
// (`GenerarReporteDiaDocumento`, tras el INSERT) como quien la lee
// (`ObtenerReporteDiaDocumento`, en el GET) -- de ahí que viva en un único
// módulo de dominio puro, sin depender de Postgres/S3, importado por los dos
// casos de uso.
//
// Estructura elegida (confirmada con Jorge): aplanada, sin carpeta por
// fecha -- `reportes-dia/{ESTACION}-{YYYYMMDD}.pdf` y
// `reportes-dia/CONSOLIDADO-{YYYYMMDD}.pdf`, todo bajo un único prefijo
// `reportes-dia/`. `estacionCodigo` ya llega en mayúsculas (columna
// `estaciones.codigo`, sección 3.3), así que no hace falta normalizar
// casing acá.

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

const PREFIJO = 'reportes-dia';
const NOMBRE_CONSOLIDADO = 'CONSOLIDADO';
const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function fechaNegocioCompacta(fechaNegocio: string): string {
  const match = FORMATO_FECHA.exec(fechaNegocio);
  if (!match) {
    // Defensivo -- en los dos casos de uso que llaman a esto, `fechaNegocio`
    // ya pasó por `normalizarFechaNegocio` (GET) o vino directo del evento
    // `CierreDiaRegistrado` (que a su vez viene de `dto.fechaNegocio`,
    // columna `date` de Postgres -- formato garantizado). Se lanza igual en
    // vez de producir una key corrupta en silencio.
    throw new ParametrosInvalidosError('"fechaNegocio" inválido al construir la key del documento.', [
      { field: 'fechaNegocio', issue: 'debe tener formato YYYY-MM-DD' },
    ]);
  }
  const [, anio, mes, dia] = match;
  return `${anio}${mes}${dia}`;
}

export function construirKeyDocumentoEstacion(estacionCodigo: string, fechaNegocio: string): string {
  return `${PREFIJO}/${estacionCodigo}-${fechaNegocioCompacta(fechaNegocio)}.pdf`;
}

export function construirKeyDocumentoConsolidado(fechaNegocio: string): string {
  return `${PREFIJO}/${NOMBRE_CONSOLIDADO}-${fechaNegocioCompacta(fechaNegocio)}.pdf`;
}
