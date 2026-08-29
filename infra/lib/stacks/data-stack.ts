// infra/lib/stacks/data-stack.ts
//
// Aurora Serverless v2 (PostgreSQL, vía Data API — sección 2.1/2.2/9.4) +
// tabla DynamoDB de idempotencia (sección 2.3, usada por AWS Lambda
// Powertools en `ingest-cierre-turno`/`ingest-cierre-dia`). Primer stack en
// el orden de despliegue (sección 12.2) — todo lo demás depende de sus
// outputs (`clusterArn`, `secretArn`, `databaseName`, `idempotencyTable`).

import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  readonly grupoId: string;
  readonly ambiente: string;
  /** VPC mínima del `NetworkStack` (sin NAT) — el cluster de Aurora la necesita, las Lambdas no (sección 9.4). */
  readonly vpc: ec2.IVpc;
}

// Nombre fijo de la base de datos dentro del cluster — no confundir con el
// nombre del stack de CDK (que sí varía por grupo/ambiente, sección 13.2).
// Cada cluster (uno por grupo×ambiente) tiene su propia base `fuelhub`
// completamente aislada de las demás — coherente con el aislamiento físico
// de la sección 13.1.
const NOMBRE_BASE_DATOS = 'fuelhub';

export class DataStack extends Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly clusterArn: string;
  public readonly secretArn: string;
  public readonly databaseName: string = NOMBRE_BASE_DATOS;
  public readonly idempotencyTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // `prod` conserva el cluster y la tabla si algún día se borra el stack
    // por error — `dev` se puede recrear libremente. Aplica a ambos recursos
    // con estado (Aurora y DynamoDB); todo lo demás en este proyecto es sin
    // estado (Lambdas, API Gateway) y no necesita esta protección.
    const removalPolicy = props.ambiente === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_9 }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, // única subred que crea NetworkStack (sin NAT)
      writer: rds.ClusterInstance.serverlessV2('writer'),
      // Scale-to-zero (sección 2.5/10.2): 0 ACU en reposo, hasta 2 ACU bajo
      // carga — de sobra para el tráfico estimado en 10.1 (4-10 estaciones).
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      defaultDatabaseName: NOMBRE_BASE_DATOS,
      credentials: rds.Credentials.fromGeneratedSecret('fuelhub_admin'),
      enableDataApi: true,
      storageEncrypted: true,
      removalPolicy,
    });

    if (!this.cluster.secret) {
      // No debería pasar nunca (se generó arriba con `fromGeneratedSecret`)
      // — guarda defensiva para que `secretArn` quede tipado como `string`
      // sin un `!` silencioso.
      throw new Error('DataStack: el cluster de Aurora no generó un secret de credenciales — revisar `credentials` en la definición de arriba.');
    }
    this.clusterArn = this.cluster.clusterArn;
    this.secretArn = this.cluster.secret.secretArn;

    // Tabla de idempotencia (sección 2.3) — esquema calcado de los defaults
    // reales de `DynamoDBPersistenceLayer` (verificado contra el paquete
    // instalado, `@aws-lambda-powertools/idempotency`, no adivinado): los
    // handlers de `ingest-cierre-turno`/`ingest-cierre-dia` instancian
    // `new DynamoDBPersistenceLayer({ tableName })` SIN overrides de
    // `keyAttr`/`expiryAttr`, así que la tabla debe tener partition key
    // `id` (string) y TTL en el atributo `expiration` (los demás atributos
    // que usa la librería — `status`, `data`, `validation`,
    // `in_progress_expiration` — son ítems normales, DynamoDB no los declara
    // en el esquema de la tabla).
    this.idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiration',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // volumen bajo e impredecible (10.1) — no vale la pena aprovisionar capacidad fija
      removalPolicy,
    });

    // ClusterArn/SecretArn/DatabaseName (v1.50) — hasta ahora solo existían
    // como propiedades TS internas de este stack, legibles por `ApiStack`
    // dentro del mismo `cdk.App` (referencia de CDK en memoria, sin
    // CloudFormation Output de por medio). `scripts/db-migrate.mjs`
    // (12.6/13.5) corre FUERA de ese `cdk.App` — es un paso de CI/CD
    // separado que necesita descubrir estos 3 valores por su cuenta contra
    // una cuenta de AWS real, así que hace falta publicarlos como Outputs.
    // Ninguno de los 3 es sensible: `clusterArn`/`databaseName` son
    // identificadores, no credenciales, y `secretArn` es solo el APUNTADOR
    // al secret de Secrets Manager (mismo criterio que nunca exponer el
    // `client_secret` de Cognito en un output, ver `auth-stack-nuevo-grupo.ts`)
    // — el valor del secret en sí nunca sale de Secrets Manager; leerlo
    // requiere permiso IAM aparte (`secretsmanager:GetSecretValue`), que es
    // exactamente el permiso que ya tiene el rol de RDS Data API y ningún
    // otro.
    new CfnOutput(this, 'ClusterArn', { value: this.clusterArn });
    new CfnOutput(this, 'SecretArn', { value: this.secretArn });
    new CfnOutput(this, 'DatabaseName', { value: this.databaseName });
  }
}
