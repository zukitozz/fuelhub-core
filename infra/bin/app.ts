#!/usr/bin/env node
// infra/bin/app.ts
//
// Entrypoint de CDK — instancia los 4 stacks en el orden de la sección 12.2
// (Network → Data → Auth → Api), parametrizados por `grupoId`/`ambiente`
// (sección 13.2): `cdk deploy --all -c grupoId=nonato -c ambiente=dev`.
//
// Región fija en `us-east-2` (Ohio) — la misma donde ya existe el User Pool
// real (sección 9.2.1); `AuthStack` importa ese User Pool por `grupoId`, así
// que desplegar en otra región lo dejaría sin poder encontrarlo.
//
// Flag `crearCognitoNuevoGrupo` (sección 13.3, Fase 2 — v1.49): por defecto
// (sin el flag) el entrypoint usa `AuthStack` (importa un User Pool ya
// existente) — el camino normal para TODOS los despliegues del día a día de
// un grupo ya dado de alta, "nonato" incluido. Pasar
// `-c crearCognitoNuevoGrupo=true -c estaciones=<CODIGO1>,<CODIGO2>,...`
// cambia el entrypoint a `AuthStackNuevoGrupo` (crea el User Pool desde
// cero) — SOLO para el primer despliegue de un grupo genuinamente nuevo (ver
// la nota de cabecera de `auth-stack-nuevo-grupo.ts` sobre por qué es
// deliberadamente un stack distinto, no un modo del mismo `AuthStack`). Un
// error común a evitar: pasar este flag para "nonato" — `AuthStackNuevoGrupo`
// intentaría crear un User Pool nuevo en vez de usar el real ya en
// producción; no hay ninguna protección de código contra eso más allá de
// esta nota, así que el flag se pasa a mano y con cuidado, nunca desde el
// CI/CD (`deploy-grupo.yml` no lo pasa — ver sección 13.5).

import { App, Tags } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { AuthStackNuevoGrupo } from '../lib/stacks/auth-stack-nuevo-grupo';
import { ApiStack } from '../lib/stacks/api-stack';
import type * as cognito from 'aws-cdk-lib/aws-cognito';

const app = new App();

const grupoId = app.node.tryGetContext('grupoId') as string | undefined;
const ambiente = app.node.tryGetContext('ambiente') as string | undefined;
const crearCognitoNuevoGrupo = app.node.tryGetContext('crearCognitoNuevoGrupo') === 'true';

if (!grupoId || !ambiente) {
  throw new Error('Uso: cdk deploy --all -c grupoId=<id> -c ambiente=<dev|prod>  (sección 13.2)');
}
if (ambiente !== 'dev' && ambiente !== 'prod') {
  throw new Error(`ambiente inválido: "${ambiente}" — debe ser "dev" o "prod" (sección 12.1: dos ambientes, no más, por grupo).`);
}

const sufijo = `${grupoId}-${ambiente}`;
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-2', // Ohio — misma región que el User Pool real, ver nota de cabecera
};

const network = new NetworkStack(app, `FuelHubNetworkStack-${sufijo}`, { env, grupoId, ambiente });

const data = new DataStack(app, `FuelHubDataStack-${sufijo}`, {
  env,
  grupoId,
  ambiente,
  vpc: network.vpc,
});

// `userPool` sale con el mismo tipo (`cognito.IUserPool`) de cualquiera de
// los 2 stacks — `ApiStack` no necesita saber cuál de los dos lo creó
// (sección 13.3, Fase 2/Fase 3: es exactamente ese punto de la migración,
// del stack "crea" al stack "importa", lo que este `if` hace explícito).
let userPool: cognito.IUserPool;

if (crearCognitoNuevoGrupo) {
  const estacionesRaw = app.node.tryGetContext('estaciones') as string | undefined;
  if (!estacionesRaw) {
    throw new Error(
      'Uso: con -c crearCognitoNuevoGrupo=true hace falta además -c estaciones=<CODIGO1>,<CODIGO2>,...  (sección 13.3, Fase 2).'
    );
  }
  const estaciones = estacionesRaw.split(',').map((codigo) => codigo.trim()).filter((codigo) => codigo.length > 0);

  const authNuevoGrupo = new AuthStackNuevoGrupo(app, `FuelHubAuthStackNuevoGrupo-${sufijo}`, {
    env,
    grupoId,
    ambiente,
    estaciones,
  });
  userPool = authNuevoGrupo.userPool;
} else {
  const auth = new AuthStack(app, `FuelHubAuthStack-${sufijo}`, { env, grupoId, ambiente });
  userPool = auth.userPool;
}

new ApiStack(app, `FuelHubApiStack-${sufijo}`, {
  env,
  grupoId,
  ambiente,
  dataStack: data,
  userPool,
});

// Etiquetado por grupo/ambiente en los 4 stacks — no cambia nada del
// comportamiento, pero permite filtrar costos reales en Cost Explorer por
// grupo (sección 13.4: el estimado de costos se duplica por cada grupo
// nuevo; con este tag se puede confirmar esa proyección con datos reales,
// en vez de solo la estimación de la sección 10).
Tags.of(app).add('grupoId', grupoId);
Tags.of(app).add('ambiente', ambiente);
