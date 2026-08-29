// packages/shared-kernel/src/AuthContext.ts
//
// Tipos y utilidades comunes a todos los microservicios (sección 6.3) para no
// duplicar la lógica de lectura/autorización del JWT en cada Lambda.
//
// Los claims vienen del Pre Token Generation Lambda (sección 9.2.2), ya
// verificados por el Cognito Authorizer nativo de API Gateway (sección 5.1)
// antes de que el handler los vea — acá solo se parsean y se ofrece la
// función de autorización por estación (sección 5.4).

export interface AuthContext {
  /** client_id de Cognito del App Client que llamó — identifica qué estación/sistema consume (sección 3.10, `cliente_origen`). */
  readonly clientId: string;
  /** custom:role del token — hoy siempre 'SISTEMA_GRIFO' para M2M (sección 9.2.2). */
  readonly role: string;
  /**
   * custom:station_scope crudo del token: un código único ("CHANCAYLLO"), una
   * lista separada por comas para un integrador multi-estación, o "*" para
   * acceso a todas las estaciones (ver la tabla de claims de la sección 5.2).
   */
  readonly stationScope: string;
  /** Scopes de OAuth2 otorgados (p. ej. ['fuelhub-api/cierres.read']) — separado de station_scope, ver 5.2. */
  readonly scopes: readonly string[];
}

/**
 * Autorización por estación (sección 5.4): nunca se confía en que el payload
 * o el query param digan la verdad por sí solos — siempre se compara contra
 * `custom:station_scope` del token ya validado.
 */
export function hasAccessToStation(auth: AuthContext, estacionCodigo: string): boolean {
  if (auth.stationScope === '*') return true;
  const codigosPermitidos = auth.stationScope
    .split(',')
    .map((codigo) => codigo.trim())
    .filter((codigo) => codigo.length > 0);
  return codigosPermitidos.includes(estacionCodigo);
}

/**
 * Cuando un cliente M2M tiene acceso a exactamente una estación (el caso más
 * común, sección 9.2.1 — cada App Client de las 4 estaciones reales trae un
 * único scope station.<CODIGO>), se puede usar como filtro por defecto sin
 * que el cliente tenga que enviarlo explícito en cada `GET` (sección 11.1).
 * Devuelve `undefined` si el token tiene acceso a varias estaciones o a
 * todas ('*') — ahí el filtro por estación queda a criterio del caller.
 */
export function estacionUnicaDelToken(auth: AuthContext): string | undefined {
  if (auth.stationScope === '*') return undefined;
  const codigos = auth.stationScope
    .split(',')
    .map((codigo) => codigo.trim())
    .filter((codigo) => codigo.length > 0);
  return codigos.length === 1 ? codigos[0] : undefined;
}

/**
 * Lista de códigos de estación a los que el token tiene acceso, ya parseada
 * de `custom:station_scope` (sección 5.4) — `'*'` sin parsear cuando el
 * token tiene acceso a todas.
 *
 * Se agrega para `consulta-reportes` (sección 3.8.2), que a diferencia de
 * `consulta-cierres` sí necesita restringir explícitamente por la lista
 * completa de estaciones del token cuando el cliente es un "integrador
 * multi-estación" (varios códigos, no wildcard) y no pide una
 * `estacionCodigo` puntual: sin esto, un reporte agregado por estación
 * mostraría TODAS las estaciones del grupo aunque el token solo tuviera
 * acceso a un subconjunto — `hasAccessToStation`/`estacionUnicaDelToken`
 * por sí solos no cubren ese caso (el primero exige un código puntual para
 * validar, el segundo solo sirve cuando hay una única estación).
 *
 * Gap pendiente (no bloqueante, dejado igual a propósito): `ListarCierresTurno`
 * y `ListarCierresDia` (consulta-cierres) tienen la misma laguna teórica —
 * si el token cubre varias estaciones explícitas (no `'*'`) y no se manda
 * `estacionCodigo`, hoy devuelven todas las estaciones sin restringir a la
 * lista del token. No se corrige ahí en esta versión porque hoy ningún App
 * Client real emite `station_scope` con más de un código (cada una de las 4
 * estaciones reales tiene su propio App Client de una sola estación, sección
 * 9.2.1) — el caso "integrador multi-estación" es hipotético hasta que se
 * emita un token así. Se prioriza cerrarlo acá porque `consulta-reportes` es
 * justo el endpoint pensado para consultas cross-estación (motivo original
 * de 3.8.2), así que es donde más importa no filtrar de más.
 */
export function estacionesPermitidasDelToken(auth: AuthContext): readonly string[] | '*' {
  if (auth.stationScope === '*') return '*';
  return auth.stationScope
    .split(',')
    .map((codigo) => codigo.trim())
    .filter((codigo) => codigo.length > 0);
}

/**
 * Parsea el AuthContext desde el evento de API Gateway (REST API con
 * Cognito User Pool Authorizer nativo, sección 5.1) — los claims llegan en
 * `event.requestContext.authorizer.claims`.
 */
export function parseAuthContext(event: {
  requestContext?: { authorizer?: { claims?: Record<string, string> } };
}): AuthContext {
  const claims = event.requestContext?.authorizer?.claims ?? {};
  const scopeRaw = claims.scope ?? '';
  return {
    clientId: claims.client_id ?? claims.sub ?? '',
    role: claims['custom:role'] ?? '',
    stationScope: claims['custom:station_scope'] ?? '',
    scopes: scopeRaw.length > 0 ? scopeRaw.split(' ') : [],
  };
}
