// infrastructure/adapters/GmailFacturaProveedorSource.ts
//
// Adaptador real de `FacturaProveedorSourcePort` contra la API de Gmail
// (v1.81) -- REST directo con `fetch` (Node 22, sin librería HTTP de más)
// en vez del SDK pesado `googleapis`; solo se usa `google-auth-library`
// (ya dependencia del repo, del script `gmail-oauth-setup.mjs`) para
// refrescar el access token a partir del refresh token guardado en
// Secrets Manager -- ese refresh token NUNCA se lee más que acá y en el
// script de configuración inicial, nunca se loguea.
//
// `etiquetaOrigen` (v1.82, multiempresa real) es un parámetro del
// constructor, NO una constante fija -- antes ("FuelHub/Proveedores") era
// la misma para todo el grupo; ahora cada estación tiene la suya propia en
// `estaciones_correo_proveedores` (migración 1788800000000), porque dos
// estaciones pueden compartir el mismo buzón físico y solo se distinguen
// por la etiqueta (confirmado con Jorge). `handler.ts` instancia un
// `GmailFacturaProveedorSource` por cada (secreto, etiqueta) distinto que
// encuentra en esa tabla -- ver su cabecera.
//
// `etiquetaOrigen` es `string | null` desde la migración 1788900000000 --
// `null` significa "sin filtro de etiqueta, sondear TODO el buzón": un
// buzón dedicado exclusivamente a facturas no necesita que Jorge etiquete
// nada a mano, todo lo que llegue (y no esté ya Procesado/Error) es
// candidato. El query de búsqueda simplemente omite el término positivo
// `label:X` en ese caso -- las exclusiones de Procesado/Error se
// mantienen siempre, filtre por etiqueta o no.
//
// `FuelHub/Procesado`/`FuelHub/Error` SÍ siguen fijas y compartidas entre
// todas las estaciones -- son solo "ya se intentó este mensaje", no hace
// falta una por estación, y evita crear docenas de etiquetas casi
// idénticas en un buzón compartido por varias estaciones.
//
//   - `<etiquetaOrigen>`: la crea JORGE a mano en Gmail y es donde mueve
//      manualmente los correos con facturas que quiere que el sistema
//      procese -- el "de dónde saco trabajo" del cron, para ESA estación.
//   - `FuelHub/Procesado` / `FuelHub/Error`: las crea este adaptador solo
//      la primera vez que hacen falta (`resolverLabelId`) -- Jorge no
//      tiene que crearlas.
//
// Query de búsqueda (`listarIdsMensajes`): `label:X -label:Y -label:Z` es
// sintaxis estándar de búsqueda de Gmail para etiquetas anidadas (el "/"
// de "FuelHub/Proveedores" es válido tal cual en el operador `label:`).
//
// `descargarXmlAdjunto` recorre `payload.parts` recursivamente (un correo
// real casi siempre es multipart: cuerpo + PDF + XML, y a veces el XML
// viene comprimido dentro de otro nivel de multipart si el proveedor lo
// mandó como adjunto de un adjunto) buscando la primera parte cuyo
// `filename` termine en `.xml`. Si no encuentra ninguna, el mensaje NO
// entra en la lista de pendientes -- se marca `FuelHub/Error` directo acá
// (no es un caso que `ProcesarFacturaProveedorCorreo` pueda hacer nada
// con él: no hay XML que parsear).

import { OAuth2Client } from 'google-auth-library';
import type { FacturaProveedorSourcePort, MensajeFacturaProveedor } from '../../application/ports/FacturaProveedorSourcePort';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const ETIQUETA_PROCESADO = 'FuelHub/Procesado';
const ETIQUETA_ERROR = 'FuelHub/Error';

export interface CredencialesGmail {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

interface GmailMessagePart {
  readonly filename?: string;
  readonly mimeType?: string;
  readonly body?: { readonly attachmentId?: string; readonly size?: number };
  readonly parts?: readonly GmailMessagePart[];
}

interface GmailMessage {
  readonly payload?: GmailMessagePart;
}

export class GmailFacturaProveedorSource implements FacturaProveedorSourcePort {
  private readonly oauth2Client: OAuth2Client;
  private cacheLabelIds: Map<string, string> | undefined;

  constructor(credenciales: CredencialesGmail, private readonly etiquetaOrigen: string | null) {
    this.oauth2Client = new OAuth2Client(credenciales.clientId, credenciales.clientSecret);
    this.oauth2Client.setCredentials({ refresh_token: credenciales.refreshToken });
  }

  async listarMensajesPendientes(): Promise<readonly MensajeFacturaProveedor[]> {
    // `etiquetaOrigen === null` -- sin filtro positivo, sondea TODO el
    // buzón (ver cabecera). Las exclusiones de Procesado/Error siempre
    // van, filtre por etiqueta o no -- son las que evitan releer el mismo
    // mensaje en corridas futuras.
    const filtroEtiqueta = this.etiquetaOrigen ? `label:${this.etiquetaOrigen} ` : '';
    const q = `${filtroEtiqueta}-label:${ETIQUETA_PROCESADO} -label:${ETIQUETA_ERROR}`;
    const ids = await this.listarIdsMensajes(q);

    const mensajes: MensajeFacturaProveedor[] = [];
    for (const id of ids) {
      const xml = await this.descargarXmlAdjunto(id);
      if (xml === undefined) {
        await this.marcarError(id); // ver nota de cabecera -- sin XML no hay nada que procesar
        continue;
      }
      mensajes.push({ mensajeId: id, xmlContenido: xml });
    }
    return mensajes;
  }

  async marcarProcesado(mensajeId: string): Promise<void> {
    await this.agregarEtiqueta(mensajeId, ETIQUETA_PROCESADO);
  }

  async marcarError(mensajeId: string): Promise<void> {
    await this.agregarEtiqueta(mensajeId, ETIQUETA_ERROR);
  }

  private async listarIdsMensajes(q: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q });
      if (pageToken) params.set('pageToken', pageToken);
      const respuesta = await this.solicitar<{ messages?: { id: string }[]; nextPageToken?: string }>(
        `${GMAIL_API_BASE}/messages?${params.toString()}`
      );
      ids.push(...(respuesta.messages ?? []).map((m) => m.id));
      pageToken = respuesta.nextPageToken;
    } while (pageToken);
    return ids;
  }

  private async descargarXmlAdjunto(mensajeId: string): Promise<string | undefined> {
    const mensaje = await this.solicitar<GmailMessage>(`${GMAIL_API_BASE}/messages/${mensajeId}?format=full`);
    const parteXml = buscarParteXml(mensaje.payload);
    if (!parteXml?.body?.attachmentId) return undefined;

    const adjunto = await this.solicitar<{ data: string }>(
      `${GMAIL_API_BASE}/messages/${mensajeId}/attachments/${parteXml.body.attachmentId}`
    );
    return Buffer.from(adjunto.data, 'base64url').toString('utf-8');
  }

  private async agregarEtiqueta(mensajeId: string, nombreEtiqueta: string): Promise<void> {
    const labelId = await this.resolverLabelId(nombreEtiqueta);
    await this.solicitar(`${GMAIL_API_BASE}/messages/${mensajeId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }

  private async resolverLabelId(nombre: string): Promise<string> {
    if (!this.cacheLabelIds) {
      const { labels } = await this.solicitar<{ labels: { id: string; name: string }[] }>(`${GMAIL_API_BASE}/labels`);
      this.cacheLabelIds = new Map(labels.map((l) => [l.name, l.id]));
    }
    const existente = this.cacheLabelIds.get(nombre);
    if (existente) return existente;

    // No existe todavía -- se crea sola (solo pasa la primera vez que hace
    // falta FuelHub/Procesado o FuelHub/Error -- FuelHub/Proveedores la
    // crea Jorge a mano, ver cabecera del archivo).
    const creada = await this.solicitar<{ id: string }>(`${GMAIL_API_BASE}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name: nombre, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    this.cacheLabelIds.set(nombre, creada.id);
    return creada.id;
  }

  private async solicitar<T>(url: string, init?: RequestInit): Promise<T> {
    const accessToken = await this.obtenerAccessToken();
    const respuesta = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.text();
      throw new Error(`Gmail API ${respuesta.status} en ${url}: ${cuerpo}`);
    }
    return (await respuesta.json()) as T;
  }

  private async obtenerAccessToken(): Promise<string> {
    const { token } = await this.oauth2Client.getAccessToken();
    if (!token) throw new Error('No se pudo obtener un access token de Gmail (¿refresh token revocado o inválido?).');
    return token;
  }
}

function buscarParteXml(parte: GmailMessagePart | undefined): GmailMessagePart | undefined {
  if (!parte) return undefined;
  const esXml = !!parte.filename && parte.filename.toLowerCase().endsWith('.xml');
  if (esXml && parte.body?.attachmentId) return parte;
  for (const sub of parte.parts ?? []) {
    const encontrada = buscarParteXml(sub);
    if (encontrada) return encontrada;
  }
  return undefined;
}
