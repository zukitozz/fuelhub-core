// infra/lib/stacks/auth-stack.ts
//
// DECISIÓN IMPORTANTE, distinta de lo que sugiere el pseudocódigo de la
// sección 13.2/13.3 — léase antes de tocar este archivo:
//
// El pseudocódigo de 13.2/13.3 muestra `new AuthStack(...)` como si este
// stack FUERA A CREAR el User Pool, el Resource Server y los App Clients de
// cada grupo por CDK. Eso todavía no existe como código — y a propósito no
// se escribe acá todavía. La razón: para el único grupo real hoy
// ("nonato"), el User Pool (`tczat3`, `us-east-2_nQ1gjcb0j`), el Resource
// Server `fuelhub-api`, los 4 App Clients M2M y el Pre Token Generation
// Lambda **ya existen en AWS**, dados de alta a mano siguiendo el checklist
// de la sección 9.2.1/9.2.2 — con secrets ya entregados a las 4 estaciones
// reales. Escribir acá un `AuthStack` que "crea" un User Pool desde cero y
// desplegarlo contra el grupo "nonato" por error duplicaría/entraría en
// conflicto con esos recursos ya en producción, con integraciones humanas
// reales (las 4 estaciones) del otro lado.
//
// Este `AuthStack` **importa** el User Pool ya existente (por `grupoId`, vía
// el mapa `USER_POOL_ID_POR_GRUPO` de abajo) — no crea nada en Cognito.
// Sigue pendiente (sección 13.6, sin cambios): escribir el `AuthStack` que
// SÍ crea Cognito desde cero por CDK, necesario recién cuando se dé de alta
// un grupo nuevo de verdad (13.3, paso 1) — hasta entonces, el paso 1 de esa
// sección se sigue haciendo a mano (mismo procedimiento de 9.2.1/9.2.2), y
// una vez creado el User Pool a mano, se registra su ID acá abajo para que
// este stack lo importe.
//
// Nota (encontrada corriendo `cdk synth` de verdad, no solo `tsc --noEmit`
// — changelog de esta versión): el `CognitoUserPoolsAuthorizer` NO se crea
// acá, aunque conceptualmente "pertenezca" a Cognito — se crea en
// `api-stack.ts`, en el mismo stack que el `RestApi` al que se adjunta.
// Crearlo acá producía un ciclo de dependencia entre stacks
// (`DependencyCycle`): el authorizer necesita el `restApiId` del API
// Gateway (`AuthStack` → `ApiStack`), y `ApiStack` a su vez necesita el
// authorizer para sus métodos (`ApiStack` → `AuthStack`) — CloudFormation no
// permite que 2 stacks se referencien mutuamente. Lo único que SÍ cruza de
// este stack hacia `ApiStack` es `userPool` (una referencia importada, sin
// recurso propio de CloudFormation detrás — `fromUserPoolId` no crea nada,
// solo apunta a un ID ya existente), así que esa dirección única no genera
// ciclo.

import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends StackProps {
  readonly grupoId: string;
  readonly ambiente: string;
}

// User Pools ya creados A MANO por grupo (sección 9.2.1) — hoy solo existe
// "nonato". Al dar de alta un grupo nuevo (13.3): crear su User Pool a mano
// (mismo checklist de 9.2.1/9.2.2, todavía no automatizado), y agregar acá
// su `userPoolId` antes de desplegar el `ApiStack` de ese grupo.
//
// Nota: el mismo User Pool sirve para `dev` y `prod` de un mismo grupo hoy
// (no hay 2 User Pools por grupo en el registro real de 9.2.1) — si más
// adelante se separan por ambiente, esta estructura pasaría a indexar por
// `${grupoId}-${ambiente}` en vez de solo `grupoId`.
const USER_POOL_ID_POR_GRUPO: Record<string, string> = {
  nonato: 'us-east-2_nQ1gjcb0j', // ver 9.2.1 — User Pool "tczat3", región us-east-2
};

// URL completa del endpoint de token OAuth2 (`.../oauth2/token`) del dominio
// Cognito configurado a mano para el User Pool de cada grupo (9.2.1) -- v1.51,
// agregado para que `scripts/smoke-test.mjs` (12.3/12.6) pueda pedir un token
// M2M real sin tenerlo hardcodeado en el script. CDK no puede derivar esto
// del Pool importado (`fromUserPoolId` no expone su dominio) así que se
// registra acá a mano, mismo criterio que `USER_POOL_ID_POR_GRUPO` de arriba.
// Debe coincidir con `openapi.yaml`
// (`components.securitySchemes.cognitoM2M.flows.clientCredentials.tokenUrl`)
// -- si uno cambia, el otro también.
const TOKEN_ENDPOINT_POR_GRUPO: Record<string, string> = {
  nonato: 'https://us-east-2nq1gjcb0j.auth.us-east-2.amazoncognito.com/oauth2/token', // dominio Cognito del User Pool "tczat3", ver 9.2.1
};

export class AuthStack extends Stack {
  public readonly userPool: cognito.IUserPool;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const userPoolId = USER_POOL_ID_POR_GRUPO[props.grupoId];
    if (!userPoolId) {
      throw new Error(
        `AuthStack: no hay un "userPoolId" registrado para el grupo "${props.grupoId}" en USER_POOL_ID_POR_GRUPO. ` +
          'Este stack IMPORTA un User Pool ya existente, no lo crea (ver el comentario grande al inicio del archivo) — ' +
          'hay que darlo de alta a mano en Cognito primero (checklist de la sección 9.2.1/9.2.2) y registrar su ID acá.'
      );
    }

    // Los scopes reales (`fuelhub-api/cierres.write`, `fuelhub-api/cierres.read`,
    // y los `fuelhub-api/station.<CODIGO>` por estación) viven en el Resource
    // Server del User Pool importado — no hace falta recrearlos ni
    // referenciarlos acá: `AuthenticatedEndpoint` (sección 6.1) los pasa como
    // string plano (`requiredScope`) directo al método de API Gateway.
    // El `CognitoUserPoolsAuthorizer` se construye en `api-stack.ts` a partir
    // de este `userPool` — ver la nota grande de cabecera (evita el ciclo
    // de dependencia entre stacks).
    this.userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', userPoolId);

    // TokenEndpoint -- v1.51, ver la nota de `TOKEN_ENDPOINT_POR_GRUPO` arriba.
    // Mismo criterio de "falla explícito, no en silencio" que el `if` de
    // `userPoolId` de arriba: si alguien agrega un grupo nuevo a
    // `USER_POOL_ID_POR_GRUPO` sin agregarlo también acá, este stack no
    // despliega -- mejor eso que un smoke-test fallando después con un error
    // de CloudFormation "Output no encontrado" difícil de rastrear hasta acá.
    const tokenEndpoint = TOKEN_ENDPOINT_POR_GRUPO[props.grupoId];
    if (!tokenEndpoint) {
      throw new Error(
        `AuthStack: no hay un "tokenEndpoint" registrado para el grupo "${props.grupoId}" en TOKEN_ENDPOINT_POR_GRUPO. ` +
          'Hay que registrar el dominio Cognito del User Pool de este grupo (9.2.1) antes de desplegar.'
      );
    }
    new CfnOutput(this, 'TokenEndpoint', { value: tokenEndpoint });
  }
}
