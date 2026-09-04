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

import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
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
    // v1.60 -- CAMBIO IMPORTANTE, hallazgo real en vivo (2026-09-04): este
    // bus se venía SOLO IMPORTANDO por nombre (`fromEventBusName`), nunca
    // creando -- y resultó que 'notificaciones-bus' NUNCA existió de verdad
    // en la cuenta (confirmado en la consola de EventBridge, ni en dev ni en
    // prod: "No hay bus de eventos personalizado"). `fromEventBusName` no
    // valida que el recurso exista (solo arma un ARN a partir del nombre),
    // así que el `cdk deploy` nunca falló ni avisó nada -- cada
    // `PutEvents` de `ingest-cierre-dia` fallaba en silencio en tiempo de
    // ejecución (best effort, sección 4.1: no rompía el `POST
    // /cierres-dia`, solo quedaba logueado en CloudWatch).
    //
    // Se cambia a CREAR el bus acá (`new events.EventBus`, no
    // `fromEventBusName`). OJO -- riesgo de colisión de nombre: si el
    // servicio de notificaciones-whatsapp TAMBIÉN crea un bus con este mismo
    // nombre en su propio stack de CDK, el deploy de ESE lado va a fallar
    // (un nombre de bus debe ser único por cuenta+región, y ya lo habría
    // creado este stack primero). Antes de que notificaciones-whatsapp
    // despliegue, hay que coordinar quién es el dueño real del bus -- si
    // terminan siendo ellos, hay que revertir esto a `fromEventBusName`.
    //
    // `RemovalPolicy.RETAIN` en prod (`DESTROY` en dev): si este stack se
    // reemplaza o se borra, las reglas que notificaciones-whatsapp haya
    // creado sobre este bus no deberían perderse por un cambio de este lado.
    const notificacionesBusName = (this.node.tryGetContext('notificacionesBusName') as string | undefined) ?? 'notificaciones-bus';
    const notificacionesBus = new events.EventBus(this, 'NotificacionesBus', {
      eventBusName: notificacionesBusName,
    });
    notificacionesBus.applyRemovalPolicy(
      props.ambiente === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    );
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

    // TODO (v1.58, pendiente de v1.57 punto 4): cuando Jorge cree el scope
    // Cognito `fuelhub-api/reportes.read` y el App Client `notificaciones-whatsapp`
    // (solo lectura, sin `cierres.write` ni `station.*`), migrar este
    // `requiredScope` de `cierres.read` a `reportes.read` — hoy se deja en
    // `cierres.read` a propósito para que sea probable de inmediato con
    // credenciales ya existentes (p. ej. `fuelhub-smoketest`) sin bloquear
    // esta entrega a que el trabajo de Cognito en consola esté listo primero.
    new AuthenticatedEndpoint(this, 'ConsultaReportesDia', {
      api,
      authorizer,
      resource: reportesDia,
      method: 'GET',
      fn: consultaReportesMargen.fn,
      requiredScope: 'fuelhub-api/cierres.read',
    });

    // --- Grants IAM (sección 6.2, principio de mínimo privilegio) --------------
    // 7 Lambdas reales en total (los 3 pares de arriba comparten `fn`).

    for (const endpoint of [
      ingestCierreTurno,
      ingestCierreDia,
      ingestCompra,
      consultaCierresTurno, // cubre también ConsultaCierresDia (mismo fn)
      consultaCierreTurnoDetalle,
      adminTanquesListar, // cubre también AdminTanquesActualizar (mismo fn)
      consultaReportesMargen, // cubre también ConsultaReportesAbastecimiento (mismo fn)
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
