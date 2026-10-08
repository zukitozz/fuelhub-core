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
// v1.85 -- formato de nombre REESCRITO a pedido de notificaciones-whatsapp:
// el último segmento de la URL firmada es, literalmente, el nombre de
// archivo que ve el usuario final al recibir el PDF por WhatsApp (Meta lo
// toma del path, no hay forma de mandar un nombre de archivo aparte). El
// formato anterior (`reportes-dia/{ESTACION}-{YYYYMMDD}.pdf`) era legible
// pero no el que pidieron -- ahora es `reportes-dia/cierre_dia_{ESTACION}_{YYYY-MM-DD}.pdf`
// (y el consolidado, `reportes-dia/cierre_dia_consolidado_{YYYY-MM-DD}.pdf`).
// Mismo archivo agrega las keys de TURNO nuevas (v1.85, pedido nuevo):
// `reportes-dia/cierre_turno_{ESTACION}_{YYYY-MM-DD}_T{N}.pdf` -- bajo el
// MISMO prefijo `reportes-dia/` que día (mismo bucket, nada bucket-level es
// día-específico; separar por prefijo alcanza).
//
// OJO -- cambio de formato = rename: los PDFs de día ya generados bajo el
// formato viejo (`{ESTACION}-{YYYYMMDD}.pdf`) quedan huérfanos (nadie los
// vuelve a pedir con la key nueva) -- sin backfill, decisión aceptada porque
// el consumidor real (el bot de WhatsApp) pide el PDF en el momento del
// evento, no días después.
//
// `estacionCodigo` ya llega en mayúsculas (columna `estaciones.codigo`,
// sección 3.3), así que no hace falta normalizar casing acá.

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

const PREFIJO = 'reportes-dia';
const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function validarFechaNegocio(fechaNegocio: string): string {
  if (!FORMATO_FECHA.test(fechaNegocio)) {
    // Defensivo -- en todos los casos de uso que llaman a esto, `fechaNegocio`
    // ya pasó por `normalizarFechaNegocio` (los GET) o vino directo de un
    // evento de EventBridge (que a su vez viene de `dto.fechaNegocio`,
    // columna `date` de Postgres -- formato garantizado). Se lanza igual en
    // vez de producir una key corrupta en silencio.
    throw new ParametrosInvalidosError('"fechaNegocio" inválido al construir la key del documento.', [
      { field: 'fechaNegocio', issue: 'debe tener formato YYYY-MM-DD' },
    ]);
  }
  return fechaNegocio; // ya viene en YYYY-MM-DD -- se usa tal cual en el nombre nuevo, a diferencia del formato compacto YYYYMMDD de antes
}

const SUFIJO_POR_TURNO: Record<'TURNO1' | 'TURNO2' | 'TURNO3', string> = {
  TURNO1: 'T1',
  TURNO2: 'T2',
  TURNO3: 'T3',
};

export function construirKeyDocumentoEstacion(estacionCodigo: string, fechaNegocio: string): string {
  return `${PREFIJO}/cierre_dia_${estacionCodigo}_${validarFechaNegocio(fechaNegocio)}.pdf`;
}

export function construirKeyDocumentoConsolidado(fechaNegocio: string): string {
  return `${PREFIJO}/cierre_dia_consolidado_${validarFechaNegocio(fechaNegocio)}.pdf`;
}

export function construirKeyDocumentoTurno(
  estacionCodigo: string,
  fechaNegocio: string,
  turno: 'TURNO1' | 'TURNO2' | 'TURNO3'
): string {
  return `${PREFIJO}/cierre_turno_${estacionCodigo}_${validarFechaNegocio(fechaNegocio)}_${SUFIJO_POR_TURNO[turno]}.pdf`;
}
