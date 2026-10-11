// application/use-cases/ObtenerReporteComprasSemanalDocumento.ts
//
// Orquesta GET /v1/reportes/compras-semanal/documento (v1.86) -- calco de
// ObtenerReporteTurnoDocumento.ts: solo resuelve la key de S3 y pide la URL
// firmada, sin tocar Postgres (eso ya pasó en el cron semanal, ver
// GenerarReporteComprasSemanalDocumento.ts).
//
// Solo recibe `estacionCodigo` + `fechaInicio` (el lunes) -- decisión de
// Jorge: `fechaFin` NO es un parámetro, se calcula acá mismo (+6 días) para
// que no pueda pedirse un rango que no sea exactamente el que anunció el
// evento `ReporteComprasSemanalRegistrado`.
//
// 404 simple cuando el documento no existe todavía -- mismo criterio que
// día/turno, notificaciones-whatsapp no reintenta 4xx.

import { AccesoDenegadoEstacionError, hasAccessToStation, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { sumarDias } from '../../domain/value-objects/RangoFechas';
import { construirKeyDocumentoComprasSemanal } from '../../domain/DocumentoReporteKey';
import { DocumentoNoEncontradoError, type DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export interface ObtenerReporteComprasSemanalDocumentoQuery {
  readonly estacionCodigo?: string;
  readonly fechaInicio?: string;
}

export interface ReporteComprasSemanalDocumentoDTO {
  readonly url: string;
  readonly tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly expiraEn: number;
}

const EXPIRACION_SEGUNDOS = 600; // mismo criterio que día/turno (v1.60) -- notificaciones-whatsapp consume la URL de inmediato
const NOMBRE_RECURSO = 'Reporte de compras semanal (documento)';

export class ObtenerReporteComprasSemanalDocumento {
  constructor(private readonly storage: DocumentoStoragePort) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteComprasSemanalDocumentoQuery): Promise<ReporteComprasSemanalDocumentoDTO> {
    if (!query.estacionCodigo?.trim()) {
      throw new ParametrosInvalidosError('"estacionCodigo" es requerido para el reporte de compras semanal.', [
        { field: 'estacionCodigo', issue: 'requerido' },
      ]);
    }
    const estacionCodigo = query.estacionCodigo.trim();

    if (!query.fechaInicio || !FORMATO_FECHA.test(query.fechaInicio)) {
      throw new ParametrosInvalidosError('"fechaInicio" inválido.', [{ field: 'fechaInicio', issue: 'requerido, formato YYYY-MM-DD' }]);
    }
    const fechaInicio = query.fechaInicio;
    const fechaFin = sumarDias(fechaInicio, 6);

    if (!hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const key = construirKeyDocumentoComprasSemanal(estacionCodigo, fechaInicio, fechaFin);

    try {
      const subido = await this.storage.obtenerUrlFirmada({ key, expiraEnSegundos: EXPIRACION_SEGUNDOS });
      return { ...subido, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    } catch (err) {
      if (err instanceof DocumentoNoEncontradoError) {
        throw new RecursoNoEncontradoError(NOMBRE_RECURSO, `${estacionCodigo} / ${fechaInicio}`);
      }
      throw err;
    }
  }
}
