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

import { XMLParser } from 'fast-xml-parser';

export class FacturaXmlInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Factura XML inválida: ${motivo}`);
    this.name = 'FacturaXmlInvalidaError';
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

  const lineasRaw = inv.InvoiceLine;
  const lineas = Array.isArray(lineasRaw) ? lineasRaw : lineasRaw !== undefined ? [lineasRaw] : [];
  if (lineas.length === 0) {
    throw new FacturaXmlInvalidaError('la factura no tiene ninguna línea (InvoiceLine) -- no hay ítems que registrar');
  }
  const items = lineas.map((linea, indice) => parsearLinea(linea, indice));

  return { rucEmisor, nombreEmisor, rucReceptor, serieCorrelativo, fechaEmision, moneda, importeTotal, items };
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

function requerirNumero(nodo: unknown, campo: string): number {
  const valor = valorDeTexto(nodo);
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (valor === undefined || Number.isNaN(numero)) {
    throw new FacturaXmlInvalidaError(`falta o no es numérico el campo requerido ${campo}`);
  }
  return numero;
}
