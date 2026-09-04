// infra/lib/constructs/authenticated-endpoint.ts
//
// Construct L3 reutilizable (sección 6.1) — Lambda + integración API Gateway
// + Cognito Authorizer + scope requerido, para que agregar un endpoint sea
// un bloque declarativo corto en `api-stack.ts`, sin repetir Lambda + rol IAM
// + integración a mano cada vez.
//
// A diferencia de la versión en pseudocódigo de la sección 6.1 (y de la
// primera versión real, changelog v1.39), este Construct resuelve el gap
// que quedó flageado en v1.32/v1.39: varias rutas que comparten un mismo
// `handler.ts` (consulta-cierres: 2 GET; admin-tanques: GET+PUT;
// consulta-reportes: 2 GET) hoy desplegaban una `NodejsFunction` NUEVA por
// cada `new AuthenticatedEndpoint(...)`, aunque el `entry` fuera idéntico —
// perdiendo el objetivo original de trazabilidad (un solo log group/rol IAM
// por par de rutas). Se resuelve con la prop opcional `fn`: si se pasa un
// Lambda ya creado, este Construct NO crea uno nuevo, solo agrega el método
// sobre el recurso indicado.
//
// De paso se cierra el otro pendiente anotado junto al anterior (v1.39): el
// Lambda usado (creado acá, o reusado vía `fn`) queda expuesto como
// `this.fn` — así `api-stack.ts` puede encadenar los grants de IAM que
// necesite cada endpoint (`dataStack.cluster.grantDataApiAccess(fn)`,
// `idempotencyTable.grantReadWriteData(fn)`, `bus.grantPutEventsTo(fn)`)
// desde afuera, sin que el Construct tenga que conocer de antemano todos los
// permisos posibles de cada microservicio (principio de mínimo privilegio,
// sección 6.2 — cada Lambda solo recibe los grants que su propio código usa).

import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  AuthorizationType,
  type CognitoUserPoolsAuthorizer,
  type IResource,
  LambdaIntegration,
  type RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { type IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { type BundlingOptions, NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

// DEFAULT_TIMEOUT -- v1.60, hallazgo real en vivo (2026-09-04): ningún
// Lambda de este Construct traía nunca un `timeout` explícito, así que TODOS
// corrían con el default de AWS Lambda a secas -- 3 SEGUNDOS. Se descubrió
// leyendo los logs reales de CloudWatch de `ingest-cierre-dia` en prod: 2 de
// 3 invocaciones recientes terminaron en "Status: timeout" a exactamente
// 3000ms, con la 3ra pasando raspando en 2388ms. Nada de esto es nuevo de
// hoy -- viene desde que existe este Construct, afecta a TODOS los
// endpoints (no solo cierres-dia), y probablemente ya venía causando fallas
// intermitentes en producción sin que nada lo señalara como error de código
// (un timeout mata el Lambda a la fuerza, sin pasar por ningún try/catch --
// ni siquiera el "best effort" de la publicación a EventBridge llega a
// correr si el timeout pega antes).
//
// 10 segundos: suficiente margen para el camino real de estos handlers
// (parseo + 1-2 llamadas a RDS Data API, a veces con el UPSERT de
// auto-provisioning de `usuarios`, más — en ingest-cierre-dia — un PutEvents
// a EventBridge) sin ser tan largo como para esconder un problema real de
// rendimiento. Se puede overridear por endpoint con `timeout` si alguno lo
// necesita distinto.
const DEFAULT_TIMEOUT = Duration.seconds(10);

export interface AuthenticatedEndpointProps {
  readonly api: RestApi;
  readonly authorizer: CognitoUserPoolsAuthorizer;
  readonly resource: IResource;
  /** Ampliado de `'GET' | 'POST'` (sección 6.1 original) a incluir `'PUT'` — lo necesita `admin-tanques` (`PUT /tanques/{id}`, sección 3.8.4), pendiente anotado en el changelog v1.39. */
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly requiredScope: string;
  /**
   * Handler ya creado, para que esta ruta reuse el mismo Lambda que otra
   * (mismo `entry`, mismo microservicio con varias operaciones). Cuando se
   * pasa, el Construct no crea ninguna función nueva — `entry`/`environment`
   * se ignoran (deben venir vacíos; si vienen igual, se lanza un error en
   * vez de crear una función redundante o silenciar la intención de compartir).
   */
  readonly fn?: IFunction;
  /** Requerido cuando NO se pasa `fn` — path al `handler.ts` del microservicio. */
  readonly entry?: string;
  /** Solo aplica cuando se crea una función nueva (no se pasa `fn`). */
  readonly environment?: Record<string, string>;
  /**
   * Raíz del monorepo (sección 6.3) para que `NodejsFunction` empaquete
   * `entry` con esbuild sin depender del directorio desde el que se invoque
   * `cdk`. Encontrado corriendo `cdk synth` de verdad (no solo `tsc
   * --noEmit`, changelog de esta versión): por defecto, `NodejsFunction`
   * busca el `package.json`/lockfile más cercano subiendo desde
   * `process.cwd()` — no desde `entry` — así que si `cdk` se invoca desde
   * `infra/` (como hace `infra/package.json`), encontraba el lockfile de
   * `infra/` y fallaba con `PathNotUnderRoot` porque `entry` (bajo
   * `services/`, fuera de `infra/`) no calzaba con esa raíz. Se resuelve
   * pasando `projectRoot`/`depsLockFilePath` explícitos, anclados con
   * `__dirname` en vez de depender del cwd. Solo aplica al crear una
   * función nueva (se ignora si se pasa `fn`).
   */
  readonly projectRoot?: string;
  /** Ver `projectRoot` — mismo criterio, explícito en vez de por búsqueda desde el cwd. */
  readonly depsLockFilePath?: string;
  /**
   * Timeout del Lambda. Solo aplica cuando se crea una función nueva (se
   * ignora si se pasa `fn`, igual que `environment`/`projectRoot`). Default
   * `DEFAULT_TIMEOUT` (10s) si no se pasa — ver la nota de cabecera de este
   * archivo (v1.60) sobre por qué hacía falta un default explícito.
   */
  readonly timeout?: Duration;
  /**
   * Overrides puntuales de `NodejsFunction.bundling`, mezclados sobre el
   * default (`{ minify: true, sourceMap: true }`) -- hoy solo lo usa
   * `consultaReportesDiaDocumento` (v1.61) para el `commandHooks` que copia
   * los `.afm` de `pdfkit` al bundle (ver la nota grande de `api-stack.ts`
   * sobre el bug real de producción que esto corrige). Solo aplica cuando
   * se crea una función nueva (se ignora si se pasa `fn`).
   */
  readonly bundling?: Partial<BundlingOptions>;
}

export class AuthenticatedEndpoint extends Construct {
  /**
   * El Lambda detrás de este endpoint — recién creado, o el que se pasó por
   * `props.fn`. Público a propósito: quien instancia el Construct necesita
   * poder encadenar grants IAM y otras configuraciones (alarms, permisos de
   * recursos) sin que este Construct tenga que anticiparlas todas.
   */
  public readonly fn: IFunction;

  constructor(scope: Construct, id: string, props: AuthenticatedEndpointProps) {
    super(scope, id);

    if (props.fn) {
      if (props.entry !== undefined || props.environment !== undefined || props.timeout !== undefined || props.bundling !== undefined) {
        throw new Error(
          `AuthenticatedEndpoint "${id}": se pasó "fn" (Lambda a reusar) junto con "entry"/"environment"/"timeout"/"bundling" — son mutuamente excluyentes. Si la intención es reusar un Lambda ya creado, no pasar ninguno de esos (el timeout/bundling ya los tiene el Lambda reusado); si la intención es crear uno nuevo, no pasar "fn".`
        );
      }
      this.fn = props.fn;
    } else {
      if (!props.entry) {
        throw new Error(
          `AuthenticatedEndpoint "${id}": hay que pasar "fn" (para reusar un Lambda ya creado) o "entry" (para crear uno nuevo) — no vino ninguno de los dos.`
        );
      }
      this.fn = new NodejsFunction(this, 'Fn', {
        entry: props.entry,
        // NODEJS_20_X (lo que decía la sección 6.1 originalmente) sale como
        // runtime deprecado al correr `cdk synth` de verdad, con fecha real
        // en el propio `aws-cdk-lib` instalado (deprecado el 2026-04-30,
        // alta deshabilitada desde 2027-02-01) — encontrado en el changelog
        // de esta versión, no algo que se pudiera ver solo con `tsc
        // --noEmit`. Se sube a NODEJS_22_X, que hoy no sale marcado como
        // deprecado.
        runtime: Runtime.NODEJS_22_X,
        environment: props.environment,
        projectRoot: props.projectRoot,
        depsLockFilePath: props.depsLockFilePath,
        timeout: props.timeout ?? DEFAULT_TIMEOUT,
        bundling: { minify: true, sourceMap: true, ...props.bundling },
      });
    }

    props.resource.addMethod(props.method, new LambdaIntegration(this.fn), {
      authorizer: props.authorizer,
      authorizationType: AuthorizationType.COGNITO,
      authorizationScopes: [props.requiredScope],
    });
  }
}
