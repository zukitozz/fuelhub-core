// infrastructure/http/ApiGatewayRequestMapper.ts

import type { ConsultaComprobanteInput } from '../../domain/ConsultaComprobanteInput';
import type { ConsultaComprobantePeriodoInput } from '../../domain/ConsultaComprobantePeriodoInput';

export interface ApiGatewayEventLike {
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
}

export function mapearConsultaComprobante(event: ApiGatewayEventLike): ConsultaComprobanteInput {
  return {
    numeracion: event.pathParameters?.numeracion ?? undefined,
    ruc: event.queryStringParameters?.ruc ?? undefined,
  };
}

/** GET /v1/comprobantes/consulta -- v1.79, ver ConsultaComprobantePeriodoInput.ts. */
export function mapearConsultaComprobantePeriodo(event: ApiGatewayEventLike): ConsultaComprobantePeriodoInput {
  const qs = event.queryStringParameters ?? {};
  return {
    rucEmisor: qs.rucEmisor ?? undefined,
    numeroDocumentoReceptor: qs.numeroDocumentoReceptor ?? undefined,
    anio: qs.anio ?? undefined,
    mes: qs.mes ?? undefined,
    dia: qs.dia ?? undefined,
    serie: qs.serie ?? undefined,
    correlativo: qs.correlativo ?? undefined,
  };
}
