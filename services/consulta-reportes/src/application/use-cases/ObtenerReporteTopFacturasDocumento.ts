// application/use-cases/ObtenerReporteTopFacturasDocumento.ts
//
// Orquesta GET /v1/reportes/top-facturas/documento (v1.89) -- calco de
// ObtenerReporteComprasSemanalDocumento.ts: solo resuelve la key de S3 y
// pide la URL firmada, sin tocar Postgres. El Excel ya se generó del lado
// de ingest-reporte-top-facturas, en el mismo POST que lo recibió (ver
// RegistrarReporteTopFacturas.ts) -- a diferencia de día/turno, acá no hace
// falta un Lambda de generación disparado por evento dentro de este
// servicio: el dato nunca vivió en Aurora.
//
// Reusa DocumentoStoragePort/DocumentoNoEncontradoError de
// ReporteDiaDocumentoPorts.ts (mismo puerto genérico que ya usan día/turno/
// compras-semanal) y construirKeyReporteTopFacturasExcel de
// @fuelhub/shared-kernel -- la MISMA función que usa
// S3ReporteTopFacturasStorageRepository.ts (otro microservicio) para
// escribir, así los dos lados nunca pueden desincronizarse en el formato de
// la key.

import { AccesoDenegadoEstacionError, hasAccessToStation, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { construirKeyReporteTopFacturasExcel } from '@fuelhub/shared-kernel';
import { DocumentoNoEncontradoError, type DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export interface ObtenerReporteTopFacturasDocumentoQuery {
  readonly estacionCodigo?: string;
  readonly semanaInicio?: string;
}

export interface ReporteTopFacturasDocumentoDTO {
  readonly url: string;
  readonly tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly expiraEn: number;
}

const EXPIRACION_SEGUNDOS = 600; // mismo criterio que día/turno/compras-semanal -- notificaciones-whatsapp consume la URL de inmediato
const NOMBRE_RECURSO = 'Reporte de top facturas (documento)';

export class ObtenerReporteTopFacturasDocumento {
  constructor(private readonly storage: DocumentoStoragePort) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteTopFacturasDocumentoQuery): Promise<ReporteTopFacturasDocumentoDTO> {
    if (!query.estacionCodigo?.trim()) {
      throw new ParametrosInvalidosError('"estacionCodigo" es requerido para el reporte de top facturas.', [
        { field: 'estacionCodigo', issue: 'requerido' },
      ]);
    }
    const estacionCodigo = query.estacionCodigo.trim();

    if (!query.semanaInicio || !FORMATO_FECHA.test(query.semanaInicio)) {
      throw new ParametrosInvalidosError('"semanaInicio" inválido.', [{ field: 'semanaInicio', issue: 'requerido, formato YYYY-MM-DD' }]);
    }
    const semanaInicio = query.semanaInicio;

    if (!hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const key = construirKeyReporteTopFacturasExcel(estacionCodigo, semanaInicio);

    try {
      const subido = await this.storage.obtenerUrlFirmada({ key, expiraEnSegundos: EXPIRACION_SEGUNDOS });
      return { ...subido, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    } catch (err) {
      if (err instanceof DocumentoNoEncontradoError) {
        throw new RecursoNoEncontradoError(NOMBRE_RECURSO, `${estacionCodigo} / ${semanaInicio}`);
      }
      throw err;
    }
  }
}
