// infra/lib/stacks/auth-stack-nuevo-grupo.ts
//
// El `AuthStack` que SÍ crea Cognito desde cero por CDK — pendiente flageado
// desde v1.42/13.6, resuelto acá. Es un stack DISTINTO de `auth-stack.ts`
// (que solo IMPORTA), no un modo alternativo del mismo — a propósito, para
// que nunca sea posible desplegar por error algo que "cree" sobre un grupo
// que ya tiene Cognito real en producción (ver la nota grande de
// `auth-stack.ts` sobre por qué "nonato" importa en vez de crear).
//
// USO PREVISTO — una sola vez por grupo, nunca más (sección 13.3, Fase 2):
//   1. Cuando se da de alta un grupo nuevo de verdad, `bin/app.ts` instancia
//      ESTE stack (no `AuthStack`) para ese primer despliegue, con la lista
//      de códigos de estación iniciales del grupo.
//   2. Terminado ese despliegue, se copia el `UserPoolId` (sale por
//      `CfnOutput` acá abajo) a `USER_POOL_ID_POR_GRUPO` en `auth-stack.ts`
//      (Fase 3 de 13.3).
//   3. A partir de ahí, `bin/app.ts` vuelve a usar `AuthStack` (import) para
//      ese grupo en TODOS los despliegues siguientes — este stack
//      (`AuthStackNuevoGrupo`) no se vuelve a desplegar para ese grupo. Si
//      se hiciera, CDK intentaría reconciliar/recrear un User Pool que ya
//      tiene App Clients reales con secrets ya entregados a estaciones
//      reales — exactamente el riesgo que este diseño evita.
//
// Qué crea (equivalente al checklist manual de 9.2.1/9.2.2, pero por CDK):
// un User Pool nuevo (plan "Essentials", requerido para M2M V3_0, 9.2.2), el
// Resource Server `fuelhub-api` con los 2 scopes compartidos
// (`cierres.write`/`cierres.read`) más un scope `station.<CODIGO>` por cada
// estación de `props.estaciones`, un App Client M2M por estación
// (`client_credentials`, con sus 3 scopes exactos — ni uno más, a
// diferencia de los scopes por defecto de `UserPoolClient`, ver más abajo),
// y el Lambda de Pre Token Generation (`services/auth-pre-token-generation/`,
// código real, no el `handler.console.js` pegado a mano que se usó para
// "nonato") conectado como trigger `V3_0`.
//
// Sobre `client_secret`: este archivo JAMÁS lo expone — ni en un
// `CfnOutput`, ni en ningún log. Solo se exponen los `client_id` (no son
// secretos). El `client_secret` de cada App Client se recoge una sola vez,
// después del despliegue, desde la consola de Cognito o `aws cognito-idp
// describe-user-pool-client` (mismo criterio que 9.2.1) — nunca de este
// documento ni de este código.

import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';
import * as path from 'node:path';

// Mismo criterio de anclaje con __dirname que api-stack.ts/authenticated-endpoint.ts
// (sección 6.1/v1.42) — necesario para que esbuild encuentre `entry` y el
// lockfile del monorepo sin importar desde dónde se invoque `cdk`.
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRE_TOKEN_GENERATION_ENTRY = path.join(REPO_ROOT, 'services', 'auth-pre-token-generation', 'src', 'handler.ts');
const DEPS_LOCK_FILE_PATH = path.join(REPO_ROOT, 'package-lock.json');

const RESOURCE_SERVER_ID = 'fuelhub-api'; // mismo identifier real que "nonato" (9.2.1) — no es un nombre libre, es el prefijo que llevan todos los scopes (`fuelhub-api/cierres.write`, etc.)

export interface AuthStackNuevoGrupoProps extends StackProps {
  readonly grupoId: string;
  readonly ambiente: string;
  /**
   * Códigos de las estaciones iniciales del grupo (sección 13.3, Fase 2) —
   * p. ej. `['CHANCAYLLO', 'MALA']`. Cada una recibe su propio scope
   * `station.<CODIGO>` y su propio App Client M2M, mismo criterio 1:1 que
   * "nonato" (9.2.1). Agregar una estación DESPUÉS de este primer deploy no
   * pasa por este stack — es un `addClient`/`addResourceServer` adicional
   * sobre el User Pool ya existente, fuera del alcance de hoy.
   */
  readonly estaciones: readonly string[];
}

export class AuthStackNuevoGrupo extends Stack {
  public readonly userPool: cognito.IUserPool;
  /** `client_id` (nunca el secret) de cada App Client creado, por código de estación — para referencia en outputs/logs del propio despliegue. */
  public readonly clientIdsPorEstacion: Record<string, string> = {};

  constructor(scope: Construct, id: string, props: AuthStackNuevoGrupoProps) {
    super(scope, id, props);

    if (props.estaciones.length === 0) {
      throw new Error(
        'AuthStackNuevoGrupo: "estaciones" no puede venir vacío — hace falta al menos 1 estación para crear sus scopes y su App Client (sección 13.3, Fase 2).'
      );
    }

    // Mismo criterio que DataStack (12.4/v1.42): `prod` conserva el User
    // Pool si el stack se borra por error (tiene App Clients reales con
    // secrets ya entregados); `dev` se puede recrear libremente.
    const removalPolicy = props.ambiente === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `fuelhub-${props.grupoId}-${props.ambiente}`,
      selfSignUpEnabled: false, // M2M únicamente en esta fase (Parte 1) — sin alta de usuarios humanos, ver 9.3
      // Requerido para que Cognito invoque el trigger de Pre Token
      // Generation con evento V3_0 (el único que soporta M2M, 9.2.2). Ya es
      // el default de un User Pool nuevo (ver el propio .d.ts de
      // `aws-cdk-lib`: "@default FeaturePlan.ESSENTIALS for a newly created
      // user pool") — se deja explícito para que quede documentado en el
      // propio código, no solo en un comentario de por qué funciona.
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy,
    });
    this.userPool = userPool;

    const cierresWrite = new cognito.ResourceServerScope({
      scopeName: 'cierres.write',
      scopeDescription: 'Enviar cierres de turno/día y compras (sección 5.1).',
    });
    const cierresRead = new cognito.ResourceServerScope({
      scopeName: 'cierres.read',
      scopeDescription: 'Consultar cierres y reportes (sección 5.1).',
    });
    const scopesPorEstacion = new Map<string, cognito.ResourceServerScope>(
      props.estaciones.map((codigo) => [
        codigo,
        new cognito.ResourceServerScope({
          scopeName: `station.${codigo}`,
          scopeDescription: `Alcance exclusivo de la estación ${codigo} (sección 9.2.1).`,
        }),
      ])
    );

    const resourceServer = userPool.addResourceServer('ResourceServer', {
      identifier: RESOURCE_SERVER_ID,
      userPoolResourceServerName: RESOURCE_SERVER_ID,
      scopes: [cierresWrite, cierresRead, ...scopesPorEstacion.values()],
    });

    for (const codigo of props.estaciones) {
      // Non-null: viene del mismo `props.estaciones` que llenó el Map arriba.
      const scopeEstacion = scopesPorEstacion.get(codigo)!;

      const client = userPool.addClient(`AppClient${codigo}`, {
        userPoolClientName: `fuelhub-${codigo.toLowerCase()}`,
        generateSecret: true,
        oAuth: {
          flows: { clientCredentials: true },
          // Explícito a propósito: el default de `UserPoolClientOptions.oAuth.scopes`
          // (PHONE/EMAIL/OPENID/PROFILE/COGNITO_ADMIN, ver el .d.ts de
          // aws-cdk-lib) es para flujos de usuario humano — no aplica a M2M
          // y hubiera dejado el App Client con scopes que Cognito ni
          // siquiera puede resolver sin usuario. Se listan solo los 3 reales,
          // mismo criterio verificado a mano en 9.2.1/9.2.2 para "nonato".
          scopes: [
            cognito.OAuthScope.resourceServer(resourceServer, cierresWrite),
            cognito.OAuthScope.resourceServer(resourceServer, cierresRead),
            cognito.OAuthScope.resourceServer(resourceServer, scopeEstacion),
          ],
        },
      });
      this.clientIdsPorEstacion[codigo] = client.userPoolClientId;

      new CfnOutput(this, `ClientId${codigo}`, {
        value: client.userPoolClientId,
        description:
          `client_id del App Client M2M de ${codigo} (grupo ${props.grupoId}, ${props.ambiente}). ` +
          'El client_secret NUNCA sale por acá — Cognito lo muestra una sola vez por consola o ' +
          '`aws cognito-idp describe-user-pool-client --include-secret` (mismo criterio que 9.2.1); ' +
          'recogerlo de ahí, nunca de un output ni de este documento.',
      });
    }

    // Pre Token Generation Lambda (sección 9.2.2) — código real y versionado
    // en services/auth-pre-token-generation/ (a diferencia del
    // `handler.console.js` pegado a mano en la consola para "nonato").
    const preTokenGenerationFn = new NodejsFunction(this, 'PreTokenGenerationFn', {
      entry: PRE_TOKEN_GENERATION_ENTRY,
      runtime: Runtime.NODEJS_22_X, // mismo criterio que authenticated-endpoint.ts (v1.42) — NODEJS_20_X sale deprecado en el aws-cdk-lib instalado
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      bundling: { minify: true, sourceMap: true },
    });

    // ⚠️ Hallazgo real leyendo la fuente instalada de `aws-cdk-lib` (no solo
    // el .d.ts, que a primera lectura confunde): el comentario del .d.ts de
    // `LambdaVersion.V3_0` dice "supported only for PRE_TOKEN_GENERATION
    // trigger", lo que sugiere usar `UserPoolOperation.PRE_TOKEN_GENERATION`.
    // Es al revés: `UserPool.addTrigger` (user-pool.js) lanza
    // `ValidationError` — "Only the `PRE_TOKEN_GENERATION_CONFIG` operation
    // supports V2_0 and V3_0 lambda version" — si el operation NO es
    // `PRE_TOKEN_GENERATION_CONFIG`. Confirmado con un `cdk synth` real
    // contra este stack (no solo lectura de código) — ver changelog de esta
    // versión: con `PRE_TOKEN_GENERATION_CONFIG` synth pasa limpio y el
    // template resultante trae `LambdaConfig.PreTokenGenerationConfig.
    // LambdaVersion = "V3_0"`, igual que lo verificado a mano en producción
    // para "nonato" (9.2.2, paso 3).
    userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG, preTokenGenerationFn, cognito.LambdaVersion.V3_0);

    new CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description:
        `User Pool ID del grupo "${props.grupoId}" (${props.ambiente}) — copiar a USER_POOL_ID_POR_GRUPO ` +
        'en auth-stack.ts (sección 13.3, Fase 3) antes del próximo deploy; a partir de ahí este stack ' +
        '(AuthStackNuevoGrupo) no se vuelve a desplegar para este grupo.',
    });
  }
}
