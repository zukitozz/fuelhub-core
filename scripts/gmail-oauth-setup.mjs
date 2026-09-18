#!/usr/bin/env node
// scripts/gmail-oauth-setup.mjs
//
// Herramienta de configuración de un solo uso para la capacidad nueva de
// leer facturas de proveedores por correo (v1.80). Corre un flujo OAuth de
// Google contra el buzón de Gmail elegido, y guarda el `refresh_token`
// resultante DIRECTO en AWS Secrets Manager -- nunca lo imprime en pantalla
// ni lo devuelve como valor de este script, para que no termine pegado en
// ningún chat/log (misma regla que el resto de esta sesión: ningún secreto
// cliente pasa por acá).
//
// Corre esto en TU máquina, con `aws configure` ya armado con tus propias
// credenciales de AWS (las de este script nunca las ve nadie más que tú) --
// Jorge, no yo, tiene acceso real a la cuenta de AWS.
//
// Uso:
//   node scripts/gmail-oauth-setup.mjs --grupo nonato --env dev \
//     --client-id "TU_CLIENT_ID.apps.googleusercontent.com" \
//     --client-secret "TU_CLIENT_SECRET"
//
// `--client-id`/`--client-secret` son los que generó LA CONSOLA DE GOOGLE
// CLOUD para el OAuth Client tipo "Desktop app" (ver la guía que te pasé) --
// no son secretos de AWS, así que pegarlos en tu propia terminal (no en el
// chat) está bien; lo único que este script protege de verdad es el
// `refresh_token` que Google emite al final, que es lo que de verdad da
// acceso al buzón.
//
// Qué hace, paso a paso:
//   1. Levanta un servidor HTTP temporal en tu máquina, en
//      http://localhost:8080/oauth2callback (el OAuth Client de Google debe
//      tener EXACTAMENTE esa URI de redirección registrada).
//   2. Imprime la URL de autorización de Google -- la abres en tu navegador,
//      inicias sesión con la cuenta de Gmail que va a ser el buzón de
//      proveedores, y aceptás el permiso (vas a ver la pantalla "Google no
//      verificó esta app" -- normal para una app de un solo usuario que
//      conocés vos mismo, sin publicar; click en "Avanzado" -> "Ir a
//      [nombre de la app] (no seguro)").
//   3. Captura el `code` que Google manda de vuelta al servidor local,
//      lo cambia por tokens (`access_token`/`refresh_token`).
//   4. Guarda `{ clientId, clientSecret, refreshToken }` en un secreto de
//      Secrets Manager nuevo (o actualiza uno existente), con el nombre
//      `fuelhubcore/<grupo>/<ambiente>/gmail-proveedores` -- mismo patrón de
//      nombres por grupo/ambiente que ya usa el resto del repo
//      (`FuelHubDataStack-<grupo>-<ambiente>`, `resolver-outputs-datastack.mjs`).
//   5. Cierra el servidor local y termina -- no vuelve a necesitarse salvo
//      que el refresh token se revoque o quieras apuntar a otro buzón.

import { OAuth2Client } from 'google-auth-library';
import { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand, ResourceExistsException } from '@aws-sdk/client-secrets-manager';
import http from 'node:http';

const REGION = 'us-east-2'; // misma región fija que el resto de infra (infra/bin/app.ts)
const PUERTO_LOCAL = 8080;
const REDIRECT_URI = `http://localhost:${PUERTO_LOCAL}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify'; // lectura + etiquetas (procesado/error) -- no manda ni borra nada

function leerArgs(argv) {
  const args = { grupo: undefined, env: undefined, clientId: undefined, clientSecret: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--grupo') args.grupo = argv[++i];
    else if (argv[i] === '--env') args.env = argv[++i];
    else if (argv[i] === '--client-id') args.clientId = argv[++i];
    else if (argv[i] === '--client-secret') args.clientSecret = argv[++i];
  }
  if (!args.grupo || !args.env || !args.clientId || !args.clientSecret) {
    throw new Error(
      'Uso: node scripts/gmail-oauth-setup.mjs --grupo <grupoId> --env <dev|prod> --client-id <...> --client-secret <...>'
    );
  }
  if (args.env !== 'dev' && args.env !== 'prod') {
    throw new Error(`--env inválido: "${args.env}" -- debe ser "dev" o "prod".`);
  }
  return args;
}

async function esperarCodigoDeAutorizacion(oauth2Client) {
  const urlAutorizacion = oauth2Client.generateAuthUrl({
    access_type: 'offline', // imprescindible -- sin esto Google NO manda refresh_token, solo access_token
    prompt: 'consent', // fuerza que reemita refresh_token incluso si ya autorizaste esta app antes
    scope: [SCOPE],
  });

  console.log('\n1. Abrí esta URL en tu navegador, con la cuenta de Gmail que va a ser el buzón de proveedores:\n');
  console.log(`   ${urlAutorizacion}\n`);
  console.log('2. Vas a ver "Google no verificó esta app" -- es esperado (ver el comentario de cabecera de este script).');
  console.log('   Click en "Avanzado" -> "Ir a [nombre de tu app] (no seguro)" -> "Continuar".\n');
  console.log(`Esperando el redirect a ${REDIRECT_URI} ...\n`);

  return new Promise((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end(`<h1>Autorización rechazada</h1><p>${error}</p><p>Podés cerrar esta pestaña.</p>`);
        servidor.close();
        reject(new Error(`Google devolvió un error de autorización: ${error}`));
        return;
      }
      res.end('<h1>Listo</h1><p>Autorización recibida -- volvé a la terminal. Podés cerrar esta pestaña.</p>');
      servidor.close();
      resolve(code);
    });
    servidor.listen(PUERTO_LOCAL);
  });
}

async function guardarEnSecretsManager(nombreSecreto, valor) {
  const client = new SecretsManagerClient({ region: REGION });
  const secretString = JSON.stringify(valor);
  try {
    await client.send(
      new CreateSecretCommand({
        Name: nombreSecreto,
        Description: 'Credenciales OAuth de Gmail para leer facturas de proveedores (v1.80) -- ver scripts/gmail-oauth-setup.mjs',
        SecretString: secretString,
      })
    );
    console.log(`Secreto nuevo creado: ${nombreSecreto}`);
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err;
    await client.send(new PutSecretValueCommand({ SecretId: nombreSecreto, SecretString: secretString }));
    console.log(`Secreto existente actualizado: ${nombreSecreto}`);
  }
}

async function main() {
  const { grupo, env, clientId, clientSecret } = leerArgs(process.argv.slice(2));
  const oauth2Client = new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT_URI });

  const code = await esperarCodigoDeAutorizacion(oauth2Client);
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'Google no devolvió refresh_token. Causa más probable: ya habías autorizado esta misma app antes y Google ' +
        'no reemite uno nuevo por default -- and revocá el acceso en https://myaccount.google.com/permissions ' +
        'para esa app y volvé a correr este script (el prompt "consent" ya está forzado, pero una revocación previa ' +
        'a veces hace falta igual).'
    );
  }

  const nombreSecreto = `fuelhubcore/${grupo}/${env}/gmail-proveedores`;
  await guardarEnSecretsManager(nombreSecreto, {
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
  });

  console.log('\nListo. El Lambda de ingest-compra-correo va a leer este secreto por su nombre -- no hace falta que hagas nada más acá.');
  console.log(`Nombre del secreto (esto sí es seguro de compartir, no contiene el token): ${nombreSecreto}`);
}

main().catch((err) => {
  console.error('gmail-oauth-setup falló:', err.message);
  process.exitCode = 1;
});
