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
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
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
// entryGenerarDocumentoDe -- v1.78, Lambda disparado por EventBridge
// (CierreDiaRegistrado) que genera y sube a S3 los PDFs de reporte de día --
// mismo criterio de separar el entry que entryDocumentoDe de arriba (ver la
// nota grande junto a `generarReporteDiaDocumento` más abajo).
function entryGenerarDocumentoDe(servicio: string): string {
  return path.join(SERVICES_ROOT, servicio, 'src', 'handler-generar-documento.ts');
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

    // --- ingest-compra: POST/GET /compras + PUT/GET /compras/{id} --------------
    // v1.66: PUT /compras/{id} agrega edición parcial + anulación (estado,
    // sección 3.8.6) -- reusa el mismo Lambda que POST /compras (mismo
    // criterio que admin-tanques: GET /tanques + PUT /tanques/{id}
    // comparten `fn` porque operan sobre el mismo agregado y bajo volumen).
    // v1.67: se agregan GET /compras (listado) y GET /compras/{id} (detalle)
    // -- gap identificado al construir specs-frontend-fuelhub-web.md
    // (sección 8.1/8.2): el CRUD del frontend nuevo no tenía forma de leer
    // compras. Ambas reusan el mismo `fn`, mismo criterio que las de arriba.

    const compras = api.root.getResource('v1')!.addResource('compras');
    const compraId = compras.addResource('{id}');

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

    new AuthenticatedEndpoint(this, 'IngestCompraActualizar', {
      api,
      authorizer,
      resource: compraId,
      method: 'PUT',
      fn: ingestCompra.fn,
      requiredScope: 'fuelhub-api/cierres.write',
    });

    new AuthenticatedEndpoint(this, 'IngestCompraListar', {
      api,
      authorizer,
      resource: compras,
      method: 'GET',
      fn: ingestCompra.fn,
      requiredScope: 'fuelhub-api/cierres.read',
    });

    new AuthenticatedEndpoint(this, 'IngestCompraObtener', {
      api,
      authorizer,
      resource: compraId,
      method: 'GET',
      fn: ingestCompra.fn,
      requiredScope: 'fuelhub-api/cierres.read',
    });

    // --- ingest-comprobante-pdf: PUT /comprobantes/{numeracion}/pdf -----------
    // Sube el PDF ya generado por fuelhub-facturador a S3 (spec pegado por
    // Jorge, ver specs-cierres-grifo-backend.md sección 3.8.9). A diferencia
    // de ReportesDocumentosBucket (que hasta v1.77 era scratch de 1 día de
    // vida, regenerado en cada request -- desde v1.78 también persiste
    // indefinidamente, ver la nota grande junto a su definición), este bucket
    // es el almacenamiento REAL y
    // persistente de los comprobantes de un grifo: SIN autoDeleteObjects,
    // SIN lifecycleRules de expiración. RemovalPolicy por defecto es RETAIN
    // -- si el stack se destruye, estos documentos no se van con él.
    const comprobantesPdfBucket = new s3.Bucket(this, 'ComprobantesPdfBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const comprobanteNumeracion = api.root.getResource('v1')!.addResource('comprobantes').addResource('{numeracion}');
    const comprobantePdf = comprobanteNumeracion.addResource('pdf');

    // requiredScope: reusa cierres.write a propósito (mismo criterio que
    // ConsultaReportesDia con cierres.read) -- el FUELHUB_CORE_CLIENT_ID que
    // fuelhub-facturador ya tiene en su .env de producción ya trae
    // fuelhub-api/cierres.write, así que el endpoint funciona apenas se
    // despliega, sin coordinar un cambio de scopes en consola de Cognito
    // primero. No toca AURORA_ENV/dataStack/idempotencyTable -- este Lambda
    // no toca Aurora ni DynamoDB (ver nota de idempotencia en el handler).
    const ingestComprobantePdf = new AuthenticatedEndpoint(this, 'IngestComprobantePdf', {
      api,
      authorizer,
      resource: comprobantePdf,
      method: 'PUT',
      entry: entryDe('ingest-comprobante-pdf'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.write',
      environment: { COMPROBANTES_PDF_BUCKET_NAME: comprobantesPdfBucket.bucketName },
    });

    comprobantesPdfBucket.grantWrite(ingestComprobantePdf.fn);

    // --- consulta-comprobante: GET /comprobantes/{numeracion}?ruc=... --------
    // Lectura publica de cara al cliente final (seccion 7 del spec original
    // de ingest-comprobante-pdf, v1.72): busca {ruc}/{numeracion}.pdf (y
    // opcionalmente .xml/-cdr.xml) en el mismo bucket, sin tocar Aurora.
    // Scope NUEVO y acotado (fuelhub-api/comprobantes.read) -- a proposito
    // NO reusa cierres.read/write: el cliente M2M de fuelhub-comprobantes no
    // necesita (ni deberia poder) leer cierres/compras, principio de minimo
    // privilegio (seccion 6.2). Falta que Jorge registre este scope nuevo en
    // el Resource Server de Cognito y cree el App Client -- ver specs doc.
    const consultaComprobante = new AuthenticatedEndpoint(this, 'ConsultaComprobante', {
      api,
      authorizer,
      resource: comprobanteNumeracion,
      method: 'GET',
      entry: entryDe('consulta-comprobante'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/comprobantes.read',
      environment: { COMPROBANTES_PDF_BUCKET_NAME: comprobantesPdfBucket.bucketName },
    });

    comprobantesPdfBucket.grantRead(consultaComprobante.fn);

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
    // de S3 a un PDF -- contrato acordado con Jorge para que
    // `notificaciones-whatsapp` lo mande directo como adjunto por WhatsApp
    // Cloud API (que pide la URL sin poder mandar headers custom, de ahí que
    // sea una URL PRESIGNADA, no un endpoint autenticado).
    //
    // v1.78 -- a pedido de Jorge, este Lambda deja de GENERAR el PDF (eso
    // ahora lo hace `generarReporteDiaDocumento` más abajo, disparado por el
    // evento `CierreDiaRegistrado` apenas se registra el cierre de día) y
    // pasa a servir SOLO lectura desde S3 -- pierde por completo pdfkit y
    // Aurora como dependencias (ver `handler-documento.ts`), Lambda más
    // liviano y sin el timeout largo que necesitaba antes.
    //
    // Bucket dedicado, sin acceso público (BLOCK_ALL -- la URL firmada es lo
    // que da acceso, no el bucket). Ya NO tiene `lifecycleRules` de
    // expiración (hasta v1.77 vivía 1 día porque el PDF se regeneraba en
    // cada request y no hacía falta guardarlo más que eso) -- desde v1.78
    // cada PDF se genera UNA VEZ con una key estable y se sirve tal cual
    // indefinidamente, así que borrarlo a las 24h rompería cualquier
    // consulta posterior. Sigue con RemovalPolicy.DESTROY + autoDeleteObjects
    // (recurso propio de este stack, no compartido como `notificaciones-bus`)
    // -- destruir el stack sigue destruyendo estos PDFs, son regenerables
    // re-disparando `GenerarReporteDiaDocumento` a mano si hiciera falta.
    const reportesDocumentosBucket = new s3.Bucket(this, 'ReportesDocumentosBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const reportesDiaDocumento = reportesDia.addResource('documento');

    // v1.61 -- bug real de producción, reportado por Jorge al probar este
    // endpoint recién desplegado: `ENOENT: no such file or directory, open
    // '/var/task/data/Helvetica.afm'`. Causa: `pdfkit` NO embebe las 14
    // fuentes estándar de PDF como JS -- son archivos `.afm` (métricas de
    // texto) que carga en tiempo de ejecución desde `<módulo>/data/*.afm`
    // (ruta relativa a su propio `__dirname`). `esbuild` (lo que usa
    // `NodejsFunction` para empaquetar) solo sigue `require`/`import` de
    // JS -- nunca copia archivos no-JS referenciados así, así que el ZIP
    // final tenía `index.js` pero ningún `data/`. Pasaba inadvertido en
    // `cdk synth`/`tsc`/`jest` (los tests unitarios usan fakes, nunca
    // llaman a pdfkit de verdad) -- solo se manifestaba invocando el Lambda
    // real. Fix estándar documentado por CDK para este caso exacto:
    // `bundling.commandHooks.afterBundling` copia `node_modules/pdfkit/js/data`
    // (con los 14 `.afm`) al bundle de salida, sin depender de que esbuild
    // lo entienda.
    const consultaReportesDiaDocumento = new AuthenticatedEndpoint(this, 'ConsultaReportesDiaDocumento', {
      api,
      authorizer,
      resource: reportesDiaDocumento,
      method: 'GET',
      entry: entryDocumentoDe('consulta-reportes'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      requiredScope: 'fuelhub-api/cierres.read',
      environment: {
        REPORTES_BUCKET_NAME: reportesDocumentosBucket.bucketName,
      },
    });

    reportesDocumentosBucket.grantRead(consultaReportesDiaDocumento.fn);

    // --- generarReporteDiaDocumento: Lambda disparado por EventBridge (v1.78) --
    // Genera y sube a S3 los 2 PDFs (individual + CONSOLIDADO) apenas se
    // registra un cierre de día -- ver GenerarReporteDiaDocumento.ts y
    // handler-generar-documento.ts. Distinto de todos los demás Lambdas de
    // este archivo: no tiene ruta de API Gateway ni Cognito Authorizer (no
    // se crea con `AuthenticatedEndpoint`, que asume un método HTTP), su
    // trigger es la `events.Rule` de abajo. SÍ necesita pdfkit (con el mismo
    // hook de `.afm` que este endpoint ya no necesita, ver arriba) y Aurora
    // (para leer el cierre de día recién grabado + los turnos del día).
    const generarReporteDiaDocumento = new NodejsFunction(this, 'GenerarReporteDiaDocumentoFn', {
      entry: entryGenerarDocumentoDe('consulta-reportes'),
      runtime: Runtime.NODEJS_22_X,
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      timeout: Duration.seconds(20),
      environment: {
        ...AURORA_ENV,
        REPORTES_BUCKET_NAME: reportesDocumentosBucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        commandHooks: {
          beforeBundling(): string[] {
            return [];
          },
          beforeInstall(): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [`cp -r "${inputDir}/node_modules/pdfkit/js/data" "${outputDir}/data"`];
          },
        },
      },
    });

    reportesDocumentosBucket.grantWrite(generarReporteDiaDocumento);
    dataStack.cluster.grantDataApiAccess(generarReporteDiaDocumento);

    // Regla de EventBridge: filtra el evento `CierreDiaRegistrado` (mismo
    // `Source`/`DetailType` que ya publica `EventBridgeCierreDiaPublisher.ts`
    // en ingest-cierre-dia, best effort) desde `notificacionesBus` hacia este
    // Lambda. `addTarget` ya deja el permiso de invocación de EventBridge ->
    // Lambda resuelto -- no hace falta un `fn.addPermission` a mano.
    new events.Rule(this, 'CierreDiaRegistradoParaReporteDocumento', {
      eventBus: notificacionesBus,
      eventPattern: {
        source: ['FuelHubCloud'],
        detailType: ['CierreDiaRegistrado'],
      },
      targets: [new targets.LambdaFunction(generarReporteDiaDocumento)],
    });

    // --- ingestCompraCorreo: Lambda por cron (v1.81, sin ruta de API) ----------
    // Lee facturas de proveedores de un buzón de Gmail (etiqueta
    // "FuelHub/Proveedores", creada a mano por Jorge) y registra la compra
    // sola -- ver ProcesarFacturaProveedorCorreo.ts (ingest-compra-correo).
    // Mismo criterio que generarReporteDiaDocumento arriba: no es un
    // AuthenticatedEndpoint (no tiene ruta HTTP), su trigger es un
    // events.Rule -- acá con `schedule` (EventBridge Scheduler / cron) en
    // vez de un eventPattern de negocio.
    //
    // El secreto con las credenciales de Gmail (clientId/clientSecret/
    // refreshToken) lo crea Jorge corriendo `scripts/gmail-oauth-setup.mjs`
    // en su máquina (nunca pasa por este repo/CDK) -- acá solo se IMPORTA
    // por nombre (mismo patrón `fuelhubcore/<grupo>/<ambiente>/<nombre>`
    // que ya usa `resolver-outputs-datastack.mjs` para otros recursos por
    // grupo/ambiente) y se le da permiso de lectura al Lambda.
    const gmailProveedoresSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GmailProveedoresSecret',
      `fuelhubcore/${props.grupoId}/${props.ambiente}/gmail-proveedores`
    );

    const ingestCompraCorreo = new NodejsFunction(this, 'IngestCompraCorreoFn', {
      entry: entryDe('ingest-compra-correo'),
      runtime: Runtime.NODEJS_22_X,
      projectRoot: REPO_ROOT,
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      timeout: Duration.seconds(60),
      environment: {
        ...AURORA_ENV,
        GMAIL_CREDENTIALS_SECRET_ARN: gmailProveedoresSecret.secretArn,
      },
    });

    dataStack.cluster.grantDataApiAccess(ingestCompraCorreo);
    gmailProveedoresSecret.grantRead(ingestCompraCorreo);

    // Cada 30 minutos en prod -- suficiente para una capacidad que
    // reemplaza digitación manual (no hay urgencia de segundos/minutos como
    // sí la tendría, por ejemplo, alertar sobre un cierre). En dev, cada 3
    // minutos cuando está prendido -- pedido explícito de Jorge para poder
    // probar el flujo completo (etiquetar un correo -> ver la compra
    // aparecer) sin esperar media hora por vuelta.
    //
    // `cronCorreoHabilitadoEnDev = false` -- APAGADO por defecto (pedido
    // explícito de Jorge, v1.81, tras la primera prueba end-to-end
    // exitosa). Dos motivos: (1) con un cron cada 3 minutos, Aurora dev
    // (modo scale-to-zero, sección 2.5/18) nunca llega a apagarse -- queda
    // encendida 24h al piso mínimo, que es la parte más cara de la factura
    // de AWS según la sección 10; (2) dev y prod leen el MISMO buzón real
    // de Gmail (un solo buzón compartido para todo el grupo, no uno por
    // ambiente) -- con ambos crones activos compiten por el mismo correo,
    // y el que gane la carrera puede terminar registrando una factura real
    // en la base de dev en vez de la de prod. Para una próxima sesión de
    // pruebas: cambiar esta constante a `true`, hacer push, probar, y
    // volver a ponerla en `false` al terminar.
    const cronCorreoHabilitadoEnDev = false;

    new events.Rule(this, 'IngestCompraCorreoSchedule', {
      schedule: events.Schedule.rate(
        Duration.minutes(props.ambiente === 'prod' ? 30 : 3)
      ),
      enabled: props.ambiente === 'prod' || cronCorreoHabilitadoEnDev,
      targets: [new targets.LambdaFunction(ingestCompraCorreo)],
    });

    // --- Grants IAM (sección 6.2, principio de mínimo privilegio) --------------
    // v1.66 agrega IngestCompraActualizar (PUT /compras/{id}), y v1.67 agrega
    // IngestCompraListar/IngestCompraObtener (GET /compras, GET
    // /compras/{id}) -- las tres reusan `ingestCompra.fn`, ninguna suma un
    // Lambda nuevo a la lista de abajo. v1.69 agrega `ingestComprobantePdf`
    // (PUT /comprobantes/{numeracion}/pdf) -- deliberadamente AFUERA de este
    // loop: no toca Aurora, así que no necesita `grantDataApiAccess`. Su
    // único grant es `comprobantesPdfBucket.grantWrite(...)`, ya hecho junto
    // a su definición más arriba. v1.72 agrega `consultaComprobante`
    // (GET /comprobantes/{numeracion}) con el mismo criterio -- tampoco toca
    // Aurora, su unico grant es `comprobantesPdfBucket.grantRead(...)`, ya
    // hecho junto a su definicion mas arriba. v1.78 saca a
    // `consultaReportesDiaDocumento` de este loop (dejó de tocar Aurora, ver
    // la nota grande de arriba) y agrega `generarReporteDiaDocumento` --
    // ese SÍ necesita `grantDataApiAccess`, pero se le da directo junto a su
    // definición más arriba (no es un `AuthenticatedEndpoint`, no calza en
    // este loop que itera `.fn` de ese Construct).

    for (const endpoint of [
      ingestCierreTurno,
      ingestCierreDia,
      ingestCompra, // cubre también IngestCompraActualizar/IngestCompraListar/IngestCompraObtener (mismo fn)
      consultaCierresTurno, // cubre también ConsultaCierresDia (mismo fn)
      consultaCierreTurnoDetalle,
      adminTanquesListar, // cubre también AdminTanquesActualizar (mismo fn)
      consultaReportesMargen, // cubre también ConsultaReportesAbastecimiento y ConsultaReportesDia (mismo fn)
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
