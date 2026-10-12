// domain/FacturaProveedorXml.ts
//
// Parsea el XML UBL 2.1 de una factura electrónica peruana (SUNAT) -- el
// adjunto que llega junto al PDF en el correo de cada proveedor (v1.80,
// capacidad nueva pedida por Jorge: leer facturas de proveedores por correo
// y registrar la compra sola, sin digitarla a mano). Función pura, sin I/O
// ni SDK de AWS -- se prueba con XML de ejemplo, sin necesitar Gmail ni
// Postgres reales; el caso de uso que orquesta todo (por escribir) es quien
// decide qué hacer con el resultado (matchear estación por RUC receptor,
// matchear producto, verificar idempotencia, etc.).
//
// Alcance a propósito acotado a comprobantes tipo Factura (elemento raíz
// `<Invoice>`) -- boletas/notas de crédito/débito quedan fuera por ahora:
// Jorge solo mencionó facturas de proveedores, y una nota de crédito
// necesitaría lógica de negocio distinta (descontar en vez de sumar) que no
// se pidió. Un correo con otro tipo de comprobante cae en
// `FacturaXmlInvalidaError` -- el caso de uso lo tratará como "no se pudo
// procesar", igual que un XML corrupto.
//
// SUNAT exige que toda factura electrónica siga el estándar UBL 2.1 con los
// mismos nombres de elemento sin importar el proveedor o el PSE (proveedor
// de servicios electrónicos) que la emitió -- por eso esto funciona igual
// para cualquier proveedor de Jorge, sin reglas por proveedor como haría
// falta si solo tuviéramos el PDF (razón por la que se confirmó con él
// exigir PDF+XML juntos, no solo PDF, antes de construir esto).
//
// Nota sobre `fast-xml-parser`: con `ignoreAttributes: false` (necesario
// para leer `unitCode`/`currencyID`), un elemento que tiene attributes deja
// de ser un valor plano y pasa a ser `{ '#text': valor, '@_atributo': ... }`
// -- pero SOLO si tiene atributos; el mismo elemento sin atributos en otro
// XML sigue siendo un valor plano. `valorDeTexto`/`requerirTexto`/
// `requerirNumero` normalizan ambas formas en un solo lugar en vez de
// repetir el chequeo en cada campo. `parseTagValue` (default `true`) además
// convierte a `number` cualquier texto con pinta de número -- incluido un
// RUC (ej. `20123456789` se vuelve el number `20123456789`, no un string);
// no hay pérdida de precisión posible (11 dígitos está lejísimos del límite
// de entero seguro de JS) así que `String(valor)` alcanza para recuperarlo.
//
// v1.81 -- `numeroLinea` (a pedido de Jorge, al planear el caso de uso que
// orquesta esto: hay que estar preparados para facturas con VARIOS
// productos en líneas distintas, aunque hoy todas las reales traen uno
// solo). Se toma de `InvoiceLine/cbc:ID` -- UBL 2.1 lo exige siempre (es el
// número de línea dentro de la factura, "1", "2", ...), pero por las dudas
// de un emisor que lo omita, cae al índice 1-based (`indice + 1`) como
// respaldo. Es justo lo que la migración 1788700000000 usa junto con
// `proveedor_ruc`/`numero_comprobante` para el índice único que evita
// reprocesar la MISMA línea dos veces sin bloquear líneas DISTINTAS de la
// misma factura.
//
// v1.86 -- hallazgo real de Jorge: cada correo de proveedor (PETROPERU
// confirmado, probablemente otros PSE también) trae, junto al XML de la
// factura, un SEGUNDO XML adjunto -- el CDR (Constancia de Recepción) que
// SUNAT emite como acuse, un documento UBL `ApplicationResponse`, no
// `Invoice`. Antes de este cambio, ese segundo XML hacía fallar
// `parsearFacturaProveedorXml` con "no se encontró el elemento raíz
// <Invoice>", y el handler (que trata CUALQUIER falla de CUALQUIER adjunto
// del correo como motivo para etiquetar `FuelHub/Error`) marcaba el correo
// entero como error -- aunque la factura real ya se hubiera registrado
// bien. `esConstanciaDeRecepcion` distingue este caso (XML válido, pero
// genuinamente no es una factura) de un XML corrupto/no soportado de
// verdad, para que el handler pueda saltarlo en silencio en vez de contar
// como fallo.
//
// Detección por CONTENIDO (pedido explícito de Jorge), no por el nombre del
// archivo adjunto ni del elemento raíz -- un PSE distinto podría nombrar el
// adjunto de otra forma, o envolver el `ApplicationResponse` con un prefijo
// de namespace distinto. La cadena `DocumentResponse > Response >
// ResponseCode` es la firma real del CDR en el estándar UBL 2.1 (con
// `removeNSPrefix: true` ya no importan los prefijos `cac:`/`cbc:`), y no
// aparece en ningún lado de una `<Invoice>` real -- confirmado a mano contra
// el XML de ejemplo de este archivo y contra dos facturas reales de
// PETROPERU que Jorge compartió (ninguna de las dos contiene ese patrón).
//
// v1.87 -- 3 campos nuevos, todos OPCIONALES (`null` si faltan -- ningún
// proveedor está obligado a incluirlos, y una factura que no sea de
// combustibles líquidos no los trae en absoluto):
//
//   - `numeroAutorizacionScop`: código de autorización del Sistema de
//     Control de Órdenes de Pedido (SCOP, Resolución OSINERG N.° 048-2003-
//     OS/CD) -- CAMPO ESTÁNDAR de UBL 2.1, `AdditionalDocumentReference/ID`
//     ("campo 31" del Anexo B de la Resolución SUNAT 245-2017, confirmado
//     contra el reglamento oficial, no solo por inspección empírica). Si
//     hubiera más de un `AdditionalDocumentReference` (ej. una guía de
//     remisión Y el SCOP en la misma factura), se toma el PRIMERO -- caso
//     no observado en ninguna de las 5 facturas reales revisadas con
//     Jorge, documentado acá por si hiciera falta revisarlo si aparece.
//   - `placa`: también estándar,
//     `Delivery/Shipment/ShipmentStage/TransportMeans/RoadTransport/LicensePlateID`.
//   - `terminalAbastecimiento`: a diferencia de los dos anteriores, este
//     SOLO vive en la extensión propietaria del PSE (`ext:UBLExtensions`
//     -> `DatosAdicionales` -> `DatoAdicional` con `Codigo = "21"`) -- no
//     es parte del estándar UBL, confianza puramente empírica (5/5
//     facturas reales de PETROPERU vía Digiflow lo traían ahí). Si el PSE
//     cambia esa numeración, este campo puede volverse `null` en silencio
//     -- aceptado, es informativo, no bloquea el registro de la compra.

import { XMLParser } from 'fast-xml-parser';

export class FacturaXmlInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Factura XML inválida: ${motivo}`);
    this.name = 'FacturaXmlInvalidaError';
  }
}

/**
 * El XML es válido y parseable, pero es una Constancia de Recepción (CDR)
 * de SUNAT -- el acuse de recepción que acompaña a la factura en el mismo
 * correo, no una factura en sí. No es un error real: el caso de uso/handler
 * que orquesta el procesamiento del correo debe omitir este adjunto sin
 * contarlo como fallo (ver nota de cabecera, v1.86).
 */
export class ConstanciaDeRecepcionError extends Error {
  constructor() {
    super('El XML es una Constancia de Recepción (CDR) de SUNAT, no una factura -- se omite, no es un error.');
    this.name = 'ConstanciaDeRecepcionError';
  }
}

export interface FacturaProveedorItemDTO {
  readonly numeroLinea: string;
  readonly descripcion: string;
  readonly cantidad: number;
  readonly unidadMedida: string;
  readonly precioUnitario: number;
  readonly importe: number;
}

export interface FacturaProveedorDTO {
  readonly rucEmisor: string;
  readonly nombreEmisor: string;
  readonly rucReceptor: string;
  readonly serieCorrelativo: string;
  readonly fechaEmision: string;
  readonly moneda: string;
  readonly importeTotal: number;
  /** v1.87 -- ver nota de cabecera. `null` si la factura no lo trae. */
  readonly numeroAutorizacionScop: string | null;
  /** v1.87 -- ver nota de cabecera. `null` si la factura no lo trae. */
  readonly placa: string | null;
  /** v1.87 -- ver nota de cabecera. `null` si la factura no lo trae (incluye el caso de un PSE que no use esta extensión propietaria). */
  readonly terminalAbastecimiento: string | null;
  readonly items: readonly FacturaProveedorItemDTO[];
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

export function parsearFacturaProveedorXml(xml: string): FacturaProveedorDTO {
  const doc = parsearXml(xml);

  const invNodo = doc.Invoice;
  if (invNodo === undefined || invNodo === null || typeof invNodo !== 'object') {
    if (esConstanciaDeRecepcion(doc)) {
      throw new ConstanciaDeRecepcionError();
    }
    throw new FacturaXmlInvalidaError(
      'no se encontró el elemento raíz <Invoice> -- ¿es una factura electrónica UBL? (boletas/notas de crédito/débito no están soportadas todavía)'
    );
  }
  const inv = invNodo as Record<string, unknown>;

  const supplier = navegar(inv, ['AccountingSupplierParty', 'Party']);
  const customer = navegar(inv, ['AccountingCustomerParty', 'Party']);

  const serieCorrelativo = requerirTexto(inv.ID, 'Invoice/ID (serie-correlativo)');
  const fechaEmision = requerirTexto(inv.IssueDate, 'Invoice/IssueDate');
  const moneda = requerirTexto(inv.DocumentCurrencyCode, 'Invoice/DocumentCurrencyCode');
  const rucEmisor = requerirTexto(
    navegar(supplier, ['PartyIdentification', 'ID']),
    'AccountingSupplierParty/Party/PartyIdentification/ID (RUC del proveedor)'
  );
  const nombreEmisor = requerirTexto(
    navegar(supplier, ['PartyLegalEntity', 'RegistrationName']),
    'AccountingSupplierParty/Party/PartyLegalEntity/RegistrationName (razón social del proveedor)'
  );
  const rucReceptor = requerirTexto(
    navegar(customer, ['PartyIdentification', 'ID']),
    'AccountingCustomerParty/Party/PartyIdentification/ID (RUC receptor -- para identificar la estación)'
  );
  const importeTotal = requerirNumero(navegar(inv, ['LegalMonetaryTotal', 'PayableAmount']), 'LegalMonetaryTotal/PayableAmount');

  const numeroAutorizacionScop = extraerNumeroAutorizacionScop(inv);
  const placa = textoOpcional(navegar(inv, ['Delivery', 'Shipment', 'ShipmentStage', 'TransportMeans', 'RoadTransport', 'LicensePlateID']));
  const terminalAbastecimiento = buscarDatoAdicional(inv, '21');

  const lineasRaw = inv.InvoiceLine;
  const lineas = Array.isArray(lineasRaw) ? lineasRaw : lineasRaw !== undefined ? [lineasRaw] : [];
  if (lineas.length === 0) {
    throw new FacturaXmlInvalidaError('la factura no tiene ninguna línea (InvoiceLine) -- no hay ítems que registrar');
  }
  const items = lineas.map((linea, indice) => parsearLinea(linea, indice));

  return {
    rucEmisor,
    nombreEmisor,
    rucReceptor,
    serieCorrelativo,
    fechaEmision,
    moneda,
    importeTotal,
    numeroAutorizacionScop,
    placa,
    terminalAbastecimiento,
    items,
  };
}

function parsearXml(xml: string): Record<string, unknown> {
  try {
    return parser.parse(xml, true) as Record<string, unknown>;
  } catch (err) {
    throw new FacturaXmlInvalidaError(`XML mal formado (${err instanceof Error ? err.message : String(err)})`);
  }
}

function parsearLinea(lineaSinTipar: unknown, indice: number): FacturaProveedorItemDTO {
  const contexto = `InvoiceLine[${indice}]`;
  if (lineaSinTipar === undefined || typeof lineaSinTipar !== 'object') {
    throw new FacturaXmlInvalidaError(`${contexto} está vacía o mal formada`);
  }
  const linea = lineaSinTipar as Record<string, unknown>;

  const numeroLineaTexto = valorDeTexto(linea.ID);
  const numeroLinea = numeroLineaTexto !== undefined && String(numeroLineaTexto).trim() !== '' ? String(numeroLineaTexto).trim() : String(indice + 1);

  const cantidadNodo = linea.InvoicedQuantity;
  const cantidad = requerirNumero(cantidadNodo, `${contexto}/InvoicedQuantity`);
  const unidadMedida = extraerAtributo(cantidadNodo, '@_unitCode') ?? 'NIU'; // NIU (unidad) es el default UBL cuando no se especifica

  const descripcion = requerirTexto(navegar(linea, ['Item', 'Description']), `${contexto}/Item/Description`);
  const precioUnitario = requerirNumero(navegar(linea, ['Price', 'PriceAmount']), `${contexto}/Price/PriceAmount`);
  const importe = requerirNumero(linea.LineExtensionAmount, `${contexto}/LineExtensionAmount`);

  return { numeroLinea, descripcion, cantidad, unidadMedida, precioUnitario, importe };
}

function navegar(nodo: unknown, ruta: readonly string[]): unknown {
  let actual = nodo;
  for (const paso of ruta) {
    if (actual === undefined || actual === null || typeof actual !== 'object') return undefined;
    actual = (actual as Record<string, unknown>)[paso];
  }
  return actual;
}

function valorDeTexto(nodo: unknown): string | number | undefined {
  if (nodo === undefined || nodo === null) return undefined;
  if (typeof nodo === 'object') return (nodo as Record<string, unknown>)['#text'] as string | number | undefined;
  if (typeof nodo === 'string' || typeof nodo === 'number') return nodo;
  return undefined;
}

function extraerAtributo(nodo: unknown, atributo: string): string | undefined {
  if (nodo === undefined || nodo === null || typeof nodo !== 'object') return undefined;
  const valor = (nodo as Record<string, unknown>)[atributo];
  return valor === undefined ? undefined : String(valor);
}

function requerirTexto(nodo: unknown, campo: string): string {
  const valor = valorDeTexto(nodo);
  if (valor === undefined || String(valor).trim() === '') {
    throw new FacturaXmlInvalidaError(`falta el campo requerido ${campo}`);
  }
  return String(valor).trim();
}

/** v1.87 -- igual que `requerirTexto` pero sin lanzar: `null` si falta o viene vacío. */
function textoOpcional(nodo: unknown): string | null {
  const valor = valorDeTexto(nodo);
  if (valor === undefined || String(valor).trim() === '') return null;
  return String(valor).trim();
}

/**
 * v1.87 -- `AdditionalDocumentReference/ID` (campo 31 del Anexo B, SUNAT
 * 245-2017 -- ver nota de cabecera). Puede venir como objeto único o como
 * array si hubiera más de uno; se toma el primero (ver nota de cabecera).
 */
function extraerNumeroAutorizacionScop(inv: Record<string, unknown>): string | null {
  const raw = inv.AdditionalDocumentReference;
  const referencias = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  if (referencias.length === 0) return null;
  return textoOpcional(navegar(referencias[0], ['ID']));
}

/**
 * v1.87 -- busca `Codigo`/`Valor` dentro de `ext:UBLExtensions` ->
 * `ext:UBLExtension[]` -> `ExtensionContent` -> `DatosAdicionales` ->
 * `DatoAdicional[]` (extensión propietaria del PSE, no estándar UBL -- ver
 * nota de cabecera). Recorre TODAS las `UBLExtension` presentes (la factura
 * suele traer 2: una con `DatosAdicionales` y otra con la firma digital
 * `ds:Signature`) en vez de asumir un índice fijo.
 */
function buscarDatoAdicional(inv: Record<string, unknown>, codigo: string): string | null {
  const raw = navegar(inv, ['UBLExtensions', 'UBLExtension']);
  const extensiones = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  for (const extension of extensiones) {
    const raw2 = navegar(extension, ['ExtensionContent', 'DatosAdicionales', 'DatoAdicional']);
    const items = Array.isArray(raw2) ? raw2 : raw2 !== undefined ? [raw2] : [];
    for (const item of items) {
      if (item === undefined || item === null || typeof item !== 'object') continue;
      const itemCodigo = valorDeTexto((item as Record<string, unknown>).Codigo);
      if (itemCodigo !== undefined && String(itemCodigo).trim() === codigo) {
        return textoOpcional((item as Record<string, unknown>).Valor);
      }
    }
  }
  return null;
}

// Firma UBL del CDR de SUNAT -- ver nota de cabecera (v1.86). Se busca en
// cualquier parte del árbol parseado, no solo bajo un nombre de raíz fijo.
const CADENA_CDR = ['DocumentResponse', 'Response', 'ResponseCode'] as const;

function esConstanciaDeRecepcion(doc: Record<string, unknown>): boolean {
  return contieneCadenaAnidadaEnAlgunLado(doc, CADENA_CDR);
}

/** ¿Existe, a partir de ESTE nodo exacto, la cadena completa de claves anidadas? */
function coincideCadenaDesdeAqui(nodo: unknown, cadena: readonly string[]): boolean {
  let actual = nodo;
  for (const paso of cadena) {
    if (actual === undefined || actual === null || typeof actual !== 'object') return false;
    actual = (actual as Record<string, unknown>)[paso];
  }
  return actual !== undefined && actual !== null;
}

/**
 * Busca la cadena en todo el árbol, no solo desde la raíz -- así la
 * detección no depende de qué nombre tenga el elemento raíz (puede variar
 * según el PSE que emitió el CDR).
 */
function contieneCadenaAnidadaEnAlgunLado(nodo: unknown, cadena: readonly string[]): boolean {
  if (coincideCadenaDesdeAqui(nodo, cadena)) return true;
  if (nodo === undefined || nodo === null || typeof nodo !== 'object') return false;
  for (const valor of Object.values(nodo as Record<string, unknown>)) {
    const candidatos = Array.isArray(valor) ? valor : [valor];
    for (const candidato of candidatos) {
      if (contieneCadenaAnidadaEnAlgunLado(candidato, cadena)) return true;
    }
  }
  return false;
}

function requerirNumero(nodo: unknown, campo: string): number {
  const valor = valorDeTexto(nodo);
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (valor === undefined || Number.isNaN(numero)) {
    throw new FacturaXmlInvalidaError(`falta o no es numérico el campo requerido ${campo}`);
  }
  return numero;
}
