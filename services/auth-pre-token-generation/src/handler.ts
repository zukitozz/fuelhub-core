// handler.ts — Pre Token Generation Lambda (sección 9.2.2).
//
// Este NO es uno de los 7 Lambdas de negocio del inventario (4.1) — es un
// trigger de Cognito, sin capas domain/application/infrastructure: recibe el
// evento de Cognito, decide los claims, y devuelve el mismo evento. No toca
// Postgres ni ningún puerto de la arquitectura hexagonal del resto del repo.
//
// Historia (ver 9.2.2): para el grupo "nonato" este Lambda se creó y conectó
// A MANO por consola, con el código pegado directo en el editor inline de
// Lambda (`handler.console.js`, nunca versionado en este repo). Para dar de
// alta un grupo NUEVO por CDK (sección 13.3/13.6), hacía falta una versión
// real y versionada — esta — que `auth-stack-nuevo-grupo.ts` despliega y
// conecta como trigger automáticamente. El comportamiento es idéntico al
// validado a mano en producción con CHANCAYLLO (9.2.2): mismo control de
// `triggerSource`, mismos claims, mismo criterio de rechazo explícito.
//
// Requiere la versión de evento V3_0 del trigger "Antes de la generación del
// token" (9.2.2) — es la única versión que Cognito invoca para M2M
// (`client_credentials`); V1_0/V2_0 no aplican acá. `auth-stack-nuevo-grupo.ts`
// conecta este handler con `userPool.addTrigger(UserPoolOperation.
// PRE_TOKEN_GENERATION_CONFIG, fn, LambdaVersion.V3_0)` — el operation
// correcto para pasar V3_0 (ver el comentario en ese archivo: usar
// `PRE_TOKEN_GENERATION` a secas con V3_0 falla en `cdk synth`, verificado).
//
// v1.72: se agrega una excepción acotada para App Clients cuyo ÚNICO scope
// solicitado es `fuelhub-api/comprobantes.read` (ej. `fuelhub-comprobantes`,
// sección 3.8.11) -- ese endpoint (`GET /comprobantes/{numeracion}`) no
// autoriza por estación (`ConsultarComprobante.ts` no recibe `AuthContext`),
// así que exigirle `station.*` a un cliente puramente de lectura de
// comprobantes no tiene sentido y bloqueaba la emisión del token por
// completo (`UserLambdaValidationException`, hallazgo real de Jorge). Para
// cualquier OTRA combinación de scopes (`cierres.write`/`cierres.read`, con
// o sin `station.*`) el comportamiento es EXACTAMENTE el mismo de siempre:
// exige un scope `fuelhub-api/station.<CODIGO>` o rechaza explícitamente.

import type { PreTokenGenerationV3TriggerEvent, PreTokenGenerationV3TriggerHandler } from 'aws-lambda';

// Único rol de sistema M2M por ahora (9.2.2) — si en el futuro se agrega otro
// tipo de integrador, se derivaría de otro scope compartido en vez de un
// valor fijo (p. ej. `fuelhub-api/role.<TIPO>`).
const ROL_SISTEMA_M2M = 'SISTEMA_GRIFO';

// Prefijo del scope exclusivo por estación (9.2.1): `fuelhub-api/station.<CODIGO>`.
const PREFIJO_SCOPE_ESTACION = 'fuelhub-api/station.';

// v1.72 -- scopes cuyo token NO necesita custom:station_scope porque ningún
// caso de uso que los consume autoriza por estación. Lista deliberadamente
// corta y explícita (allowlist, no una regla general) para no aflojar sin
// querer el requisito de station.* de scopes que sí lo necesitan.
const SCOPES_SIN_STATION_REQUERIDO = new Set(['fuelhub-api/comprobantes.read']);

export const handler: PreTokenGenerationV3TriggerHandler = async (
  event: PreTokenGenerationV3TriggerEvent
): Promise<PreTokenGenerationV3TriggerEvent> => {
  // Reservado para cuando este mismo trigger empiece a recibir también
  // flujos de usuario humano (Fase 2, sección 9.3) — no se toca el evento.
  // Hoy el tipo de @types/aws-lambda solo modela `TokenGeneration_ClientCredentials`
  // para V3_0 (no hay otro triggerSource M2M posible), pero se deja el check
  // explícito por si Cognito empieza a invocar este trigger con otro origen.
  if ((event.triggerSource as string) !== 'TokenGeneration_ClientCredentials') {
    return event;
  }

  const scopesSolicitados = event.request.scopes ?? [];

  // v1.72: si TODOS los scopes solicitados están en la lista de "no
  // requiere station" (hoy, solo comprobantes.read), se emite el token sin
  // agregar custom:role/custom:station_scope -- ver nota de cabecera.
  const todosExentos =
    scopesSolicitados.length > 0 && scopesSolicitados.every((scope) => SCOPES_SIN_STATION_REQUERIDO.has(scope));
  if (todosExentos) {
    return event;
  }

  const scopeEstacion = scopesSolicitados.find((scope) => scope.startsWith(PREFIJO_SCOPE_ESTACION));

  if (!scopeEstacion) {
    // Falla explícito en vez de emitir un token con `station_scope` vacío —
    // evita que un App Client mal configurado obtenga un token "huérfano"
    // que ningún caso de uso sabría autorizar correctamente (9.2.2).
    throw new Error(
      `El App Client "${event.callerContext.clientId}" no tiene ningún scope "${PREFIJO_SCOPE_ESTACION}*" en la solicitud — no se puede emitir un token sin station_scope (ver sección 9.2.2).`
    );
  }

  const codigoEstacion = scopeEstacion.slice(PREFIJO_SCOPE_ESTACION.length);

  event.response.claimsAndScopeOverrideDetails = {
    accessTokenGeneration: {
      claimsToAddOrOverride: {
        'custom:role': ROL_SISTEMA_M2M,
        'custom:station_scope': codigoEstacion,
      },
    },
  };

  return event;
};
