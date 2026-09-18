#!/usr/bin/env node
// scripts/gmail-oauth-setup.mjs
//
// Herramienta de configuración para la capacidad de leer facturas de
// proveedores por correo (v1.80, multiempresa real desde v1.82). Corre un
// flujo OAuth de Google contra el buzón de Gmail elegido, y guarda el
// `refresh_token` resultante DIRECTO en AWS Secrets Manager -- nunca lo
// imprime en pantalla ni lo devuelve como valor de este script, para que
// no termine pegado en ningún chat/log (misma regla que el resto de esta
// sesión: ningún secreto cliente pasa por acá).
//
// Corre esto en TU máquina, con `aws configure` ya armado con tus propias
// credenciales de AWS (las de este script nunca las ve nadie más que tú) --
// Jorge, no yo, tiene acceso real a la cuenta de AWS.
//
// v1.82 -- ya NO hay un único buzón compartido por grupo/ambiente. Ahora
// corrés este script UNA VEZ POR BUZÓN (`--buzon <slug>`, un nombre libre
// que vos elegís -- ej. "chancayllo", "grupo-compartido") y el nombre del
// secreto que arma es `fuelhubcore/<grupo>/<ambiente>/gmail-proveedores/<slug>`.
// Ese nombre completo es lo que después va en la columna
// `nombre_secreto_gmail` de la tabla `estaciones_correo_proveedores`
// (migración 1788800000000) para cada estación que lea de ese buzón -- si
// dos estaciones comparten buzón, las dos filas repiten el mismo slug acá.
//
// Uso:
//   node scripts/gmail-oauth-setup.mjs --grupo nonato --env prod --buzon chancayllo \
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
//      inicias sesión con la cuenta de Gmail de ESE buzón, y aceptás el
//      permiso (la primera vez vas a ver la pantalla "Google no verificó
//      esta app" si la app todavía no está publicada -- click en
//      "Avanzado" -> "Ir a [nombre de la app] (no seguro)"; si ya está
//      publicada en Producción, como la de Jorge, ni siquiera debería
//      aparecer).
//   3. Captura el `code` que Google manda de vuelta al servidor local,
//      lo cambia por tokens (`access_token`/`refresh_token`).
//   4. Guarda `{ clientId, clientSecret, refreshToken }` en un secreto de
//      Secrets Manager nuevo (o actualiza uno existente), con el nombre
//      `fuelhubcore/<grupo>/<ambiente>/gmail-proveedores/<buzon>`.
//   5. Cierra el servidor local y termina -- no vuelve a necesitarse para
//      ESE buzón salvo que el refresh token se revoque. Para agregar un
//      buzón nuevo (empresa nueva, o separar una que compartía buzón),
//      corré este mismo script de nuevo con otro `--buzon`.

import { OAuth2Client } from 'google-auth-library';
import { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand, ResourceExistsException } from '@aws-sdk/client-secrets-manager';
import http from 'node:http';

const REGION = 'us-east-2'; // misma región fija que el resto de infra (infra/bin/app.ts)
const PUERTO_LOCAL = 8080;
const REDIRECT_URI = `http://localhost:${PUERTO_LOCAL}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify'; // lectura + etiquetas (procesado/error) -- no manda ni borra nada

const PATRON_SLUG = /^[a-z0-9][a-z0-9-]*$/;

function leerArgs(argv) {
  const args = { grupo: undefined, env: undefined, buzon: undefined, clientId: undefined, clientSecret: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--grupo') args.grupo = argv[++i];
    else if (argv[i] === '--env') args.env = argv[++i];
    else if (argv[i] === '--buzon') args.buzon = argv[++i];
    else if (argv[i] === '--client-id') args.clientId = argv[++i];
    else if (argv[i] === '--client-secret') args.clientSecret = argv[++i];
  }
  if (!args.grupo || !args.env || !args.buzon || !args.clientId || !args.clientSecret) {
    throw new Error(
      'Uso: node scripts/gmail-oauth-setup.mjs --grupo <grupoId> --env <dev|prod> --buzon <slug> --client-id <...> --client-secret <...>'
    );
  }
  if (args.env !== 'dev' && args.env !== 'prod') {
    throw new Error(`--env inválido: "${args.env}" -- debe ser "dev" o "prod".`);
  }
  if (!PATRON_SLUG.test(args.buzon)) {
    throw new Error(
      `--buzon inválido: "${args.buzon}" -- minúsculas, números y guiones solamente (va directo en el nombre del secreto de Secrets Manager).`
    );
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
  const { grupo, env, buzon, clientId, clientSecret } = leerArgs(process.argv.slice(2));
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

  const nombreSecreto = `fuelhubcore/${grupo}/${env}/gmail-proveedores/${buzon}`;
  await guardarEnSecretsManager(nombreSecreto, {
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
  });

  console.log('\nListo. Ahora falta el paso en la base: agregá (o actualizá) la fila correspondiente en');
  console.log('estaciones_correo_proveedores para cada estación que lea de este buzón, con:');
  console.log(`  nombre_secreto_gmail = '${nombreSecreto}'`);
  console.log('  etiqueta_gmail       = la etiqueta que le vas a poner a los correos de esa estación en Gmail');
  console.log('\nNombre del secreto (esto sí es seguro de compartir, no contiene el token): ' + nombreSecreto);
}

main().catch((err) => {
  console.error('gmail-oauth-setup falló:', err.message);
  process.exitCode = 1;
});
