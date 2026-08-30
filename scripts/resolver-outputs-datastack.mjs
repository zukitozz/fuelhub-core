// scripts/resolver-outputs-datastack.mjs
//
// Extraído de `db-migrate.mjs` (v1.50) al escribir `test-integration.mjs`
// (12.6), que necesita exactamente la misma resolución — Outputs de
// `FuelHubDataStack-<grupo>-<ambiente>` por CloudFormation (ClusterArn/
// SecretArn/DatabaseName, ver `infra/lib/stacks/data-stack.ts`) — para
// construir su propio `RDSDataClient`. Un solo lugar en vez de dos copias
// del mismo bloque; el comportamiento no cambió, solo dónde vive.

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

export async function resolverConexionAuroraDataApi(grupo, ambiente, region) {
  const stackName = `FuelHubDataStack-${grupo}-${ambiente}`;
  const cfn = new CloudFormationClient({ region });
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = Stacks?.[0]?.Outputs ?? [];
  const buscar = (key) => outputs.find((o) => o.OutputKey === key)?.OutputValue;

  const resourceArn = buscar('ClusterArn');
  const secretArn = buscar('SecretArn');
  const database = buscar('DatabaseName');
  if (!resourceArn || !secretArn || !database) {
    throw new Error(
      `No se pudieron leer ClusterArn/SecretArn/DatabaseName de los Outputs del stack "${stackName}". ` +
        '¿Se desplegó DataStack de este grupo/ambiente antes (orden de 12.2/deploy-grupo.yml)? ' +
        '¿Es una versión de DataStack anterior a v1.50 (sin estos 3 CfnOutput)?'
    );
  }
  return { resourceArn, secretArn, database };
}
