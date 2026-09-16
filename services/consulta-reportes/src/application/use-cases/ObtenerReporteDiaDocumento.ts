// application/use-cases/ObtenerReporteDiaDocumento.ts
//
// Orquesta GET /v1/reportes/dia/documento.
//
// v1.78 -- cambio de arquitectura a pedido de Jorge: este caso de uso deja
// de CONSULTAR Postgres y RENDERIZAR el PDF (eso ahora pasa una sola vez,
// al recibir el cierre de día -- ver `GenerarReporteDiaDocumento`) y pasa a
// ser puramente "resolver qué key le corresponde a este request" + "pedirle
// a S3 una URL firmada de esa key". Por eso el constructor pierde
// `ReporteDiaQueryRepository`/`ReporteDiaRendererPort` -- solo queda
// `DocumentoStoragePort`. Si la key no existe todavía en S3
// (`DocumentoNoEncontradoError`), se traduce a `RecursoNoEncontradoError`
// (404) -- decisión confirmada con Jorge: sin fallback a generar al vuelo
// (eso reintroduciría el acoplamiento -- y las dependencias de pdfkit/RDS
// Data API -- que este cambio busca sacar de este Lambda).
//
// Resolución de estación / consolidado, con un ajuste de seguridad nuevo
// respecto a v1.60-v1.77 (ver el bloque `else` más abajo): antes, un token
// multi-estación explícito (no wildcard) sin `estacionCodigo` recibía un
// CONSOLIDADO armado en el momento, acotado a SU lista de estaciones
// permitidas (`estacionesPermitidasDelToken`). Ahora el CONSOLIDADO es un
// único PDF pre-generado con TODAS las estaciones activas del grupo
// (`GenerarReporteDiaDocumento`) -- ya no hay forma de servir un recorte por
// token sin volver a generar al vuelo. Dejarlo pasar igual filtraría datos
// de estaciones fuera del alcance de ese token, así que ahora SOLO un token
// wildcard (`*`) puede pedir el consolidado; cualquier otro token que no
// resuelva a una única estación recibe 403. Hoy esto no cambia ningún
// comportamiento real: el único App Client sin una única estación es
// `fuelhub-notificaciones-whatsapp`, que ya es wildcard -- el caso
// "multi-estación explícito, no wildcard" sigue siendo teórico (ningún
// App Client real tiene más de un `station.<CODIGO>` en su scope, ver
// también la nota equivalente de `consulta-cierres`).

import {
  AccesoDenegadoEstacionError,
  estacionesPermitidasDelToken,
  estacionUnicaDelToken,
  hasAccessToStation,
  RecursoNoEncontradoError,
  type AuthContext,
} from '@fuelhub/shared-kernel';
import { normalizarFechaNegocio } from '../../domain/value-objects/RangoFechas';
import { construirKeyDocumentoConsolidado, construirKeyDocumentoEstacion } from '../../domain/DocumentoReporteKey';
import { DocumentoNoEncontradoError, type DocumentoStoragePort, type DocumentoSubidoDTO } from '../ports/ReporteDiaDocumentoPorts';

export interface ObtenerReporteDiaDocumentoQuery {
  readonly estacionCodigo?: string;
  readonly fechaNegocio?: string;
}

export interface ReporteDiaDocumentoDTO extends DocumentoSubidoDTO {
  readonly tipo: 'application/pdf';
}

const EXPIRACION_SEGUNDOS = 600; // 10 min -- notificaciones-whatsapp consume la URL de inmediato al recibirla (contrato acordado con Jorge, v1.60). Sin cambios en v1.78.
const NOMBRE_RECURSO = 'Reporte de día (documento)';

export class ObtenerReporteDiaDocumento {
  constructor(private readonly storage: DocumentoStoragePort) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteDiaDocumentoQuery): Promise<ReporteDiaDocumentoDTO> {
    const fechaNegocio = normalizarFechaNegocio(query.fechaNegocio);
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    let key: string;
    if (estacionCodigo !== undefined) {
      if (!hasAccessToStation(auth, estacionCodigo)) {
        throw new AccesoDenegadoEstacionError(estacionCodigo);
      }
      key = construirKeyDocumentoEstacion(estacionCodigo, fechaNegocio);
    } else {
      // Sin estacionCodigo y el token no resuelve a una única estación -- ver
      // la nota grande de cabecera sobre por qué solo wildcard puede pasar acá.
      if (estacionesPermitidasDelToken(auth) !== '*') {
        throw new AccesoDenegadoEstacionError('CONSOLIDADO');
      }
      key = construirKeyDocumentoConsolidado(fechaNegocio);
    }

    try {
      const subido = await this.storage.obtenerUrlFirmada({ key, expiraEnSegundos: EXPIRACION_SEGUNDOS });
      return { ...subido, tipo: 'application/pdf' };
    } catch (err) {
      if (err instanceof DocumentoNoEncontradoError) {
        throw new RecursoNoEncontradoError(NOMBRE_RECURSO, `${estacionCodigo ?? 'CONSOLIDADO'} / ${fechaNegocio}`);
      }
      throw err;
    }
  }
}
