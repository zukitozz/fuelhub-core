// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Este Lambda solo resuelve `GET /cierres-turno/{id}` (sección 11.2) — el
// único dato que necesita del evento crudo es el path param `id`.

export interface ApiGatewayEventLike {
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function extraerId(event: ApiGatewayEventLike): string | undefined {
  return event.pathParameters?.id ?? undefined;
}
