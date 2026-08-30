// scripts/resolver-outputs-api-auth.mjs
//
// Mismo mecanismo que `resolver-outputs-datastack.mjs` (CloudFormation
// DescribeStacks), pero para los 2 Outputs que `smoke-test.mjs` (12.3/12.6)
// necesita y que no existían hasta v1.51: `ApiUrl`
// (`FuelHubApiStack-<grupo>-<ambiente>`, agregado en `api-stack.ts`) y
// `TokenEndpoint` (`FuelHubAuthStack-<grupo>-<ambiente>`, agregado en
// `auth-stack.ts`). Se separa de `resolver-outputs-datastack.mjs` en vez de
// agregarse ahí porque son 2 stacks distintos de `DataStack` -- un solo
// helper por stack de origen, mismo criterio ya establecido en ese archivo.
//
// Nota: si el grupo se desplegó con `-c crearCognitoNuevoGrupo=true` (13.3,
// Fase 2), el stack de Auth real es `FuelHubAuthStackNuevoGrupo-<sufijo>`, no
// `FuelHubAuthStack-<sufijo>` -- no es el caso de "nonato" hoy (ver la nota
// de cabecera de `infra/bin/app.ts`), y `AuthStackNuevoGrupo` tampoco expone
// todavía un `TokenEndpoint` (gap ya flageado, fuera de alcance de esta
// versión). Este resolver asume siempre el nombre del stack de import.

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

async function leerOutput(cfn, stackName, outputKey) {
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = Stacks?.[0]?.Outputs ?? [];
  return outputs.find((o) => o.OutputKey === outputKey)?.OutputValue;
}

export async function resolverApiUrlYTokenEndpoint(grupo, ambiente, region) {
  const cfn = new CloudFormationClient({ region });
  const apiStackName = `FuelHubApiStack-${grupo}-${ambiente}`;
  const authStackName = `FuelHubAuthStack-${grupo}-${ambiente}`;

  const [apiUrl, tokenEndpoint] = await Promise.all([
    leerOutput(cfn, apiStackName, 'ApiUrl'),
    leerOutput(cfn, authStackName, 'TokenEndpoint'),
  ]);

  if (!apiUrl) {
    throw new Error(
      `No se pudo leer el Output "ApiUrl" del stack "${apiStackName}". ` +
        '¿Se desplegó ApiStack de este grupo/ambiente antes (orden de 12.2)? ' +
        '¿Es una versión de api-stack.ts anterior a v1.51 (sin este CfnOutput)?'
    );
  }
  if (!tokenEndpoint) {
    throw new Error(
      `No se pudo leer el Output "TokenEndpoint" del stack "${authStackName}". ` +
        '¿Se desplegó AuthStack de este grupo/ambiente antes? ' +
        '¿Es una versión de auth-stack.ts anterior a v1.51 (sin este CfnOutput)?'
    );
  }
  return { apiUrl, tokenEndpoint };
}
