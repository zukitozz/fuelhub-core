// infrastructure/http/ApiGatewayRequestMapper.ts

import type { ConsultaComprobanteInput } from '../../domain/ConsultaComprobanteInput';

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
