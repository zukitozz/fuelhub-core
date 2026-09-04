// application/use-cases/ObtenerReporteDiaDocumento.ts
//
// Orquesta GET /v1/reportes/dia/documento (v1.60). Reusa exactamente la
// misma resolución de autorización/estación que ObtenerReporteDia (sección
// 5.4) para el caso de una sola estación -- la diferencia real está en qué
// pasa cuando NO se manda estacionCodigo y el token no resuelve a una única
// estación (multi-estación explícito, o wildcard '*'): en vez del 400 que
// tira ObtenerReporteDia (ese endpoint no tiene forma de devolver un
// agregado en su forma JSON de hoy), acá se arma el reporte CONSOLIDADO de
// todas las estaciones a las que el token tiene acceso.
//
// El cliente M2M "fuelhub-notificaciones-whatsapp" (station.* wildcard,
// v1.60 -- ver la nota grande en infra/lib/stacks/api-stack.ts) es hoy el
// único App Client real que puede llegar al camino consolidado: es el único
// sin una única estación en su station_scope.

import {
  AccesoDenegadoEstacionError,
  estacionesPermitidasDelToken,
  estacionUnicaDelToken,
  hasAccessToStation,
  ParametrosInvalidosError,
  RecursoNoEncontradoError,
  type AuthContext,
} from '@fuelhub/shared-kernel';
import { normalizarFechaNegocio } from '../../domain/value-objects/RangoFechas';
import type { ReporteDiaDTO, ReporteDiaQueryRepository } from '../ports/ReporteDiaQueryRepository';
import type { DocumentoStoragePort, DocumentoSubidoDTO, ReporteDiaRendererPort } from '../ports/ReporteDiaDocumentoPorts';

export interface ObtenerReporteDiaDocumentoQuery {
  readonly estacionCodigo?: string;
  readonly fechaNegocio?: string;
}

export interface ReporteDiaDocumentoDTO extends DocumentoSubidoDTO {
  readonly tipo: 'application/pdf';
}

const EXPIRACION_SEGUNDOS = 600; // 10 min -- notificaciones-whatsapp consume la URL de inmediato al recibirla (contrato acordado con Jorge, v1.60).
const CONTENT_TYPE = 'application/pdf';

export class ObtenerReporteDiaDocumento {
  constructor(
    private readonly repo: ReporteDiaQueryRepository,
    private readonly renderer: ReporteDiaRendererPort,
    private readonly storage: DocumentoStoragePort
  ) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteDiaDocumentoQuery): Promise<ReporteDiaDocumentoDTO> {
    const fechaNegocio = normalizarFechaNegocio(query.fechaNegocio);
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    let buffer: Buffer;
    let key: string;

    if (estacionCodigo !== undefined) {
      // Mismo camino que ObtenerReporteDia (individual): 403 explícito si el
      // token no tiene acceso a esa estación puntual, sea porque vino en el
      // query param o porque resolvió sola del token.
      if (!hasAccessToStation(auth, estacionCodigo)) {
        throw new AccesoDenegadoEstacionError(estacionCodigo);
      }
      const reporte = await this.repo.obtener({ estacionCodigo, fechaNegocio });
      if (reporte === null) {
        throw new RecursoNoEncontradoError('Cierre de día', `${estacionCodigo} / ${fechaNegocio}`);
      }
      buffer = await this.renderer.renderizarPdf({ modo: 'individual', reporte });
      key = `reportes-dia/${fechaNegocio}/${estacionCodigo}-${Date.now()}.pdf`;
    } else {
      // Sin estacionCodigo y el token no resuelve a una única estación: solo
      // llega acá un token multi-estación o wildcard ('*') -- si fuera de una
      // sola estación, estacionUnicaDelToken ya la hubiera devuelto arriba.
      const codigos = await this.resolverCodigosConsolidado(auth);
      const reportes = await this.obtenerReportesDeCodigos(codigos, fechaNegocio);
      if (reportes.length === 0) {
        throw new RecursoNoEncontradoError('Cierre de día', `(consolidado) / ${fechaNegocio}`);
      }
      buffer = await this.renderer.renderizarPdf({ modo: 'consolidado', fechaNegocio, reportes });
      key = `reportes-dia/${fechaNegocio}/consolidado-${Date.now()}.pdf`;
    }

    const subido = await this.storage.subirYFirmar({
      buffer,
      key,
      contentType: CONTENT_TYPE,
      expiraEnSegundos: EXPIRACION_SEGUNDOS,
    });

    return { ...subido, tipo: 'application/pdf' };
  }

  private async resolverCodigosConsolidado(auth: AuthContext): Promise<readonly string[]> {
    const permitidos = estacionesPermitidasDelToken(auth);
    if (permitidos === '*') {
      return this.repo.listarCodigosEstacionesActivas();
    }
    if (permitidos.length === 0) {
      // Token sin ningún código de estación en su scope -- no debería poder
      // pasar el Pre Token Generation Lambda (9.2.2, siempre exige al menos
      // un scope station.*), pero se deja el chequeo explícito en vez de
      // devolver un consolidado vacío en silencio.
      throw new ParametrosInvalidosError('El token no tiene ninguna estación asociada.', [
        { field: 'estacionCodigo', issue: 'requerido -- el token no resuelve a ninguna estación' },
      ]);
    }
    return permitidos;
  }

  private async obtenerReportesDeCodigos(codigos: readonly string[], fechaNegocio: string): Promise<ReporteDiaDTO[]> {
    const resultados = await Promise.all(codigos.map((estacionCodigo) => this.repo.obtener({ estacionCodigo, fechaNegocio })));
    return resultados.filter((r): r is ReporteDiaDTO => r !== null);
  }
}
