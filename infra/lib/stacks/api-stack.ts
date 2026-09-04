// infra/lib/stacks/api-stack.ts
//
// API Gateway + las 7 integraciones Lambda reales del inventario (sección
// 4.1), usando el Construct reutilizable `AuthenticatedEndpoint` (sección
// 6.1, implementación real en `../constructs/authenticated-endpoint.ts`).
// Reemplaza a `api-stack.snippet.ts` (que se deja igual, como referencia de
// "solo el bloque de wiring" para copiar/pegar en discusiones — este archivo
// es el que de verdad se despliega).
//
// Último en el orden de despliegue (sección 12.2): depende de `DataStack`
// (Aurora + tabla de idempotencia) y de `AuthStack` (el authorizer de
// Cognito, sobre el User Pool ya existente — ver la nota grande en
// `auth-stack.ts`).

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import { AuthenticatedEndpoint } from '../constructs/authenticated-endpoint';
import type { DataStack } from './data-stack';

// Dos problemas de rutas encontrados corriendo `cdk synth` DE VERDAD (no
// solo `tsc --noEmit` — ver changelog de esta versión), ambos con la misma
// causa raíz: varias piezas de CDK/esbuild resuelven rutas relativas al
// directorio de trabajo del proceso (`process.cwd()`, que es `infra/` según
// `infra/package.json`), no relativas a este archivo ni a `entry`:
//
//   1. `entry: 'services/.../handler.ts'` (ruta relativa a secas) fallaba
//      con `CannotFindEntryFile` al invocar `cdk` desde `infra/` — el
//      microservicio vive en `../services/`, no en `infra/services/`.
//   2. Ya con `entry` absoluto, `NodejsFunction` seguía fallando con
//      `PathNotUnderRoot`: por defecto busca el lockfile/`package.json` más
//      cercano subiendo desde `process.cwd()` (`infra/`, que tiene su propio
//      `package.json`/`package-lock.json`) para fijar el `projectRoot` del
//      bundling con esbuild — y como `entry` (bajo `services/`) queda FUERA
//      de `infra/`, esa raíz detectada automáticamente no lo contenía.
//
// Se resuelven ambos anclando todo con `__dirname` (independiente del cwd
// desde el que se invoque `cdk`) y pasando `projectRoot`/`depsLockFilePath`
// explícitos apuntando a la raíz real del monorepo (`fuelhub-services/`,
// sección 6.3), no a `infra/`.
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SERVICES_ROOT = path.join(REPO_ROOT, 'services');
const DEPS_LOCK_FILE_PATH = path.join(REPO_ROOT, 'package-lock.json');
function entryDe(servicio: string): string {
  return path.join(SERVICES_ROOT, servicio, 'src', 'handler.ts');
}
// entryDocumentoDe -- v1.60, GET /reportes/dia/documento: Lambda separado con
// su propio entry (handler-documento.ts, no handler.ts) -- ver la nota
// grande junto a `ConsultaReportesDiaDocumento` más abajo sobre por qué.
function entryDocumentoDe(servicio: string): string {
  return path.join(SERVICES_ROOT, servicio, 'src', 'handler-documento.ts');
}

export interface ApiStackProps extends StackProps {
  readonly grupoId: string;
  readonly ambiente: string;
  readonly dataStack: DataStack;
  /** User Pool importado de `AuthStack` — el `CognitoUserPoolsAuthorizer` se construye acá mismo, no en `AuthStack` (ver la nota grande en `auth-stack.ts` sobre por qué, si no, se produce un `DependencyCycle`). */
  readonly userPool: cognito.IUserPool;
}

export class ApiStack extends Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { dataStack } = props;

    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `fuelhub-api-${props.grupoId}-${props.ambiente}`,
      deployOptions: { stageName: props.ambiente },
    });
    const api = this.api;

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: `fuelhub-authorizer-${props.grupoId}-${props.ambiente}`,
    });

    // `notificaciones-bus`: recurso COMPARTIDO con el servicio independiente
    // de notificaciones (`specs-notificaciones-whatsapp.md`, fuera de
    // alcance de este documento — ver nota en `ingest-cierre-dia`, sección
    // 4.1).
    //
    // v1.60 -- se había cambiado esto por un momento a CREAR el bus acá
    // (`new events.EventBus`), tras confirmar en la consola de EventBridge
    // que 'notificaciones-bus' no existía todavía (ni en dev ni en prod) —
    // hallazgo real en vivo, 2026-09-04. Se revierte a `fromEventBusName`
    // (import por referencia, no creación) porque el intento de `cdk deploy`
    // con la versión que lo creaba falló de inmediato con "Resource of type
    // 'AWS::Events::EventBus' with identifier notificaciones-bus already
    // exists" — el bus ya existe en la cuenta (se ve que se creó fuera de
    // este stack, a mano en la consola, entre el hallazgo y este deploy), así
    // que "crearlo" ya no es lo correcto: `fromEventBusName` es exactamente
    // lo que hace falta para un recurso que ya existe y no es dueño este
    // stack. `grantPutEventsTo` funciona igual sobre un bus importado que
    // sobre uno creado acá, así que el resto del wiring no cambia.
    const notificacionesBusName = (this.node.tryGetContext('notificacionesBusName') as string | undefined) ?? 'notificaciones-bus';
    const notificacionesBus = events.EventBus.fromEventBusName(this, 'NotificacionesBus', notificacionesBusName);
    new CfnOutput(this, 'NotificacionesBusArn', { value: notificacionesBus.eventBusArn });

    const AURORA_ENV = {
      AURORA_CLUSTER_ARN: dataStack.clusterArn,
      AURORA_SECRET_ARN: dataStack.secretArn,
      AURORA_DATABASE_NAME: dataStack.databaseName,
    };

    // --- Resources compartidos entre los 3 Lambdas de /cierres-turno -----------

    const cierresTurno = api.root.addResource('v1').addResource('cierres-turno');
    const cierresDia = api.root.getResource('v1')!.addResource('cierres-dia');

    // --- ingest-cierre-turno: POST /cierres-turno --------------------------------

    const ingestCierreTurno = new AuthenticatedEndpoint(this, 'IngestCierreTurno', {
      api,
      authorizer,
      resource: cierresTurno,
      method: 'POST',
      entry: entryDe('ingest-cierre-turno'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.write',
      environment: { ...AURORA_ENV, IDEMPOTENCY_TABLE_NAME: dataStack.idempotencyTable.tableName },
    });

    // --- ingest-cierre-dia: POST /cierres-dia ------------------------------------

    const ingestCierreDia = new AuthenticatedEndpoint(this, 'IngestCierreDia', {
      api,
      authorizer,
      resource: cierresDia,
      method: 'POST',
      entry: entryDe('ingest-cierre-dia'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.write',
      environment: {
        ...AURORA_ENV,
        IDEMPOTENCY_TABLE_NAME: dataStack.idempotencyTable.tableName,
        EVENTBRIDGE_BUS_NAME: notificacionesBus.eventBusName,
      },
    });

    // --- ingest-compra: POST /compras --------------------------------------------

    const compras = api.root.getResource('v1')!.addResource('compras');

    const ingestCompra = new AuthenticatedEndpoint(this, 'IngestCompra', {
      api,
      authorizer,
      resource: compras,
      method: 'POST',
      entry: entryDe('ingest-compra'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.write',
      environment: AURORA_ENV,
    });

    // --- consulta-cierres: GET /cierres-turno + GET /cierres-dia ---------------
    // Un solo Lambda para las 2 rutas de listado (sección 4.1) — la segunda
    // reusa el `fn` de la primera (ver `authenticated-endpoint.ts`).

    const consultaCierresTurno = new AuthenticatedEndpoint(this, 'ConsultaCierresTurno', {
      api,
      authorizer,
      resource: cierresTurno,
      method: 'GET',
      entry: entryDe('consulta-cierres'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.read',
      environment: AURORA_ENV,
    });

    new AuthenticatedEndpoint(this, 'ConsultaCierresDia', {
      api,
      authorizer,
      resource: cierresDia,
      method: 'GET',
      fn: consultaCierresTurno.fn,
      requiredScope: 'fuelhub-api/cierres.read',
    });

    // --- consulta-cierre-detalle: GET /cierres-turno/{id} -----------------------
    // Lambda separado a propósito (trazabilidad: log group/rol IAM propios).

    const cierreTurnoDetalle = cierresTurno.addResource('{id}');

    const consultaCierreTurnoDetalle = new AuthenticatedEndpoint(this, 'ConsultaCierreTurnoDetalle', {
      api,
      authorizer,
      resource: cierreTurnoDetalle,
      method: 'GET',
      entry: entryDe('consulta-cierre-detalle'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.read',
      environment: AURORA_ENV,
    });

    // --- admin-tanques: GET /tanques + PUT /tanques/{id} ------------------------
    // Sin alta vía API (sección 3.8.4) — solo consulta y reasignación.

    const tanques = api.root.getResource('v1')!.addResource('tanques');
    const tanqueId = tanques.addResource('{id}');

    const adminTanquesListar = new AuthenticatedEndpoint(this, 'AdminTanquesListar', {
      api,
      authorizer,
      resource: tanques,
      method: 'GET',
      entry: entryDe('admin-tanques'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.read',
      environment: AURORA_ENV,
    });

    new AuthenticatedEndpoint(this, 'AdminTanquesActualizar', {
      api,
      authorizer,
      resource: tanqueId,
      method: 'PUT',
      fn: adminTanquesListar.fn,
      requiredScope: 'fuelhub-api/cierres.write',
    });

    // --- consulta-reportes: GET /reportes/margen + GET /reportes/abastecimiento + GET /reportes/dia ---
    // Reportes cross-estación (3.8.2). `/reportes/dia` se agrega en v1.58
    // (gap identificado en el contrato con `notificaciones-whatsapp`, v1.57).

    const reportes = api.root.getResource('v1')!.addResource('reportes');
    const reportesMargen = reportes.addResource('margen');
    const reportesAbastecimiento = reportes.addResource('abastecimiento');
    const reportesDia = reportes.addResource('dia');

    const consultaReportesMargen = new AuthenticatedEndpoint(this, 'ConsultaReportesMargen', {
      api,
      authorizer,
      resource: reportesMargen,
      method: 'GET',
      entry: entryDe('consulta-reportes'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.read',
      environment: AURORA_ENV,
    });

    new AuthenticatedEndpoint(this, 'ConsultaReportesAbastecimiento', {
      api,
      authorizer,
      resource: reportesAbastecimiento,
      method: 'GET',
      fn: consultaReportesMargen.fn,
      requiredScope: 'fuelhub-api/cierres.read',
    });

    // NOTA (v1.60, corrige un supuesto del TODO de v1.58 de abajo): ese TODO
    // decía que el App Client `notificaciones-whatsapp` se crearía "sin
    // `station.*`" -- eso NO es viable con el Pre Token Generation Lambda
    // real (`services/auth-pre-token-generation/src/handler.ts`, 9.2.2): ese
    // trigger EXIGE que el App Client pida al menos un scope
    // `fuelhub-api/station.<algo>` en la solicitud de token y hace `throw`
    // si no encuentra ninguno -- ningún App Client sin scope de estación
    // puede obtener token, sea cual sea su intención de solo-lectura.
    //
    // Camino verificado (no aplicado todavía -- decisión de Jorge pendiente,
    // ver también la nota de scopes en `auth-stack.ts`): si se opta por un
    // único App Client "admin" de solo lectura para `notificaciones-whatsapp`
    // en vez de reusar las 4 credenciales por estación que ya existen, se
    // resuelve SOLO con configuración de Cognito, sin tocar el Lambda ni
    // este archivo: agregar el scope `fuelhub-api/station.*` (wildcard) al
    // Resource Server, y darle ese scope + `cierres.read` al App Client
    // nuevo. El Lambda ya toma "lo que sigue después de `station.`" como
    // `custom:station_scope` sin ningún caso especial -- con `station.*`
    // eso da literalmente `custom:station_scope: '*'`, que
    // `hasAccessToStation`/`estacionUnicaDelToken`
    // (`packages/shared-kernel/src/AuthContext.ts`) ya interpretan como
    // acceso a cualquier estación. La alternativa (usar directo las 4
    // credenciales por estación ya existentes desde el lado de
    // `notificaciones-whatsapp`, sin crear ningún cliente nuevo) no requiere
    // ningún cambio acá ni en Cognito -- sigue evaluándose cuál conviene.
    //
    // TODO (v1.58, pendiente de v1.57 punto 4): si en algún momento se crea
    // el scope Cognito `fuelhub-api/reportes.read`, migrar este
    // `requiredScope` de `cierres.read` a `reportes.read` -- hoy se deja en
    // `cierres.read` a propósito para que sea probable de inmediato con
    // credenciales ya existentes (p. ej. `fuelhub-smoketest`) sin bloquear
    // esta entrega a que el trabajo de Cognito en consola esté listo primero.
    // OJO: migrar esto rompería a los 4 App Clients reales ya en producción
    // (CHANCAYLLO, MALA, ANDAHUASI, PACHACUTEC) a menos que también se les
    // agregue el scope nuevo primero -- cambio de mayor alcance, no atado a
    // esta entrega.
    new AuthenticatedEndpoint(this, 'ConsultaReportesDia', {
      api,
      authorizer,
      resource: reportesDia,
      method: 'GET',
      fn: consultaReportesMargen.fn,
      requiredScope: 'fuelhub-api/cierres.read',
    });

    // --- consulta-reportes: GET /reportes/dia/documento (v1.60) ----------------
    // Variante de /reportes/dia que en vez de JSON devuelve una URL firmada
    // de S3 a un PDF ya renderizado -- contrato acordado con Jorge para que
    // `notificaciones-whatsapp` lo mande directo como adjunto por WhatsApp
    // Cloud API (que pide la URL sin poder mandar headers custom, de ahí que
    // sea una URL PRESIGNADA, no un endpoint autenticado). Lambda separado
    // del resto de `consulta-reportes` (`fn` propio, no se pasa `fn:
    // consultaReportesMargen.fn` como con margen/abastecimiento/dia): trae
    // dependencias (pdfkit, @aws-sdk/client-s3, s3-request-presigner) y un
    // timeout más largo que los otros 3 (generar PDF + subir a S3) que no
    // tiene sentido cargarle a esos Lambdas más livianos.
    //
    // Bucket dedicado, sin acceso público (BLOCK_ALL -- la URL firmada es lo
    // que da acceso, no el bucket), con expiración de objetos a 1 día (cada
    // PDF se regenera en cada request; no hace falta guardarlos más que eso)
    // y RemovalPolicy.DESTROY + autoDeleteObjects: a diferencia de
    // `notificaciones-bus` (recurso compartido y externo a este stack, ver
    // la nota de arriba), este bucket es propio de este stack y su contenido
    // es 100% regenerable -- no hay motivo para retenerlo si el stack se
    // destruye.
    const reportesDocumentosBucket = new s3.Bucket(this, 'ReportesDocumentosBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: Duration.days(1) }],
    });

    const reportesDiaDocumento = reportesDia.addResource('documento');

    const consultaReportesDiaDocumento = new AuthenticatedEndpoint(this, 'ConsultaReportesDiaDocumento', {
      api,
      authorizer,
      resource: reportesDiaDocumento,
      method: 'GET',
      entry: entryDocumentoDe('consulta-reportes'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.read',
      timeout: Duration.seconds(20),
      environment: {
        ...AURORA_ENV,
        REPORTES_BUCKET_NAME: reportesDocumentosBucket.bucketName,
      },
    });

    reportesDocumentosBucket.grantReadWrite(consultaReportesDiaDocumento.fn);

    // --- Grants IAM (sección 6.2, principio de mínimo privilegio) --------------
    // 8 Lambdas reales en total (los 3 pares de arriba comparten `fn`; v1.60
    // suma `consultaReportesDiaDocumento`, que SÍ es un Lambda propio -- no
    // comparte `fn` con nadie, ver la nota grande de arriba).

    for (const endpoint of [
      ingestCierreTurno,
      ingestCierreDia,
      ingestCompra,
      consultaCierresTurno, // cubre también ConsultaCierresDia (mismo fn)
      consultaCierreTurnoDetalle,
      adminTanquesListar, // cubre también AdminTanquesActualizar (mismo fn)
      consultaReportesMargen, // cubre también ConsultaReportesAbastecimiento y ConsultaReportesDia (mismo fn)
      consultaReportesDiaDocumento, // v1.60 -- fn propio, ver nota de arriba
    ]) {
      dataStack.cluster.grantDataApiAccess(endpoint.fn);
    }

    dataStack.idempotencyTable.grantReadWriteData(ingestCierreTurno.fn);
    dataStack.idempotencyTable.grantReadWriteData(ingestCierreDia.fn);

    notificacionesBus.grantPutEventsTo(ingestCierreDia.fn);

    // ApiUrl -- v1.51, agregado para que `scripts/smoke-test.mjs` (12.3/12.6)
    // pueda descubrir la URL real del API Gateway por CloudFormation en vez
    // de necesitar que alguien la pegue a mano — mismo criterio que
    // `ClusterArn`/`SecretArn`/`DatabaseName` de `data-stack.ts` (v1.50).
    // `this.api.url` ya incluye el stage (`.../dev/` o `.../prod/`) con "/"
    // final.
    new CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
