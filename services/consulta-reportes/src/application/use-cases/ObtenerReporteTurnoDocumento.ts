// application/use-cases/ObtenerReporteTurnoDocumento.ts
//
// Orquesta GET /v1/reportes/turno/documento (v1.85) -- calco de
// ObtenerReporteDiaDocumento.ts: solo resuelve la key de S3 y pide la URL
// firmada, sin tocar Postgres/pdfkit (eso ya pasó al momento del cierre, ver
// GenerarReporteTurnoDocumento.ts).
//
// A diferencia de día, `estacionCodigo` es SIEMPRE obligatorio acá -- pedido
// explícito: "estacionCodigo es obligatorio en este endpoint (solo lo
// reciben administradores de una estación; el dueño no recibe cierres de
// turno)". No hay resolución por token único ni modo consolidado.
//
// "Reporte no listo" (cierre existe pero el PDF todavía no terminó de
// generarse, o directamente nunca existió) se modela igual que día: 404
// simple, sin distinguir los dos casos -- notificaciones-whatsapp confirmó
// que cualquiera de los dos (404 o 409) les sirve, así que se reusa el
// mismo patrón ya probado en vez de sumar un error/código nuevo.

import { AccesoDenegadoEstacionError, hasAccessToStation, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { normalizarFechaNegocio } from '../../domain/value-objects/RangoFechas';
import { construirKeyDocumentoTurno } from '../../domain/DocumentoReporteKey';
import { DocumentoNoEncontradoError, type DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';

const TURNOS_VALIDOS = new Set(['TURNO1', 'TURNO2', 'TURNO3']);

export interface ObtenerReporteTurnoDocumentoQuery {
  readonly estacionCodigo?: string;
  readonly fechaNegocio?: string;
  readonly turno?: string;
}

export interface ReporteTurnoDocumentoDTO {
  readonly url: string;
  readonly tipo: 'application/pdf';
  readonly expiraEn: number;
}

const EXPIRACION_SEGUNDOS = 600; // mismo criterio que el reporte de día (v1.60) -- 10 min, notificaciones-whatsapp consume la URL de inmediato al recibirla
const NOMBRE_RECURSO = 'Reporte de turno (documento)';

export class ObtenerReporteTurnoDocumento {
  constructor(private readonly storage: DocumentoStoragePort) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteTurnoDocumentoQuery): Promise<ReporteTurnoDocumentoDTO> {
    const fechaNegocio = normalizarFechaNegocio(query.fechaNegocio);

    if (!query.estacionCodigo?.trim()) {
      throw new ParametrosInvalidosError('"estacionCodigo" es requerido para el reporte de turno.', [
        { field: 'estacionCodigo', issue: 'requerido' },
      ]);
    }
    const estacionCodigo = query.estacionCodigo.trim();

    if (!query.turno || !TURNOS_VALIDOS.has(query.turno)) {
      throw new ParametrosInvalidosError('"turno" inválido.', [
        { field: 'turno', issue: 'debe ser uno de: TURNO1, TURNO2, TURNO3' },
      ]);
    }
    const turno = query.turno as 'TURNO1' | 'TURNO2' | 'TURNO3';

    if (!hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const key = construirKeyDocumentoTurno(estacionCodigo, fechaNegocio, turno);

    try {
      const subido = await this.storage.obtenerUrlFirmada({ key, expiraEnSegundos: EXPIRACION_SEGUNDOS });
      return { ...subido, tipo: 'application/pdf' };
    } catch (err) {
      if (err instanceof DocumentoNoEncontradoError) {
        throw new RecursoNoEncontradoError(NOMBRE_RECURSO, `${estacionCodigo} / ${fechaNegocio} / ${turno}`);
      }
      throw err;
    }
  }
}
