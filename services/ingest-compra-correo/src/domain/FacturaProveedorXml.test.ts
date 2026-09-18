// FacturaProveedorXml.test.ts
//
// XML de ejemplo con las particularidades reales de una factura SUNAT UBL
// 2.1 (namespaces `cac:`/`cbc:`, atributos `schemeID`/`unitCode`/
// `currencyID`, razón social en CDATA) -- comprobado a mano contra
// `fast-xml-parser` antes de escribir el parser (ver el comentario de
// cabecera de FacturaProveedorXml.ts). No es un comprobante real de ningún
// proveedor de Jorge -- pendiente confirmar contra uno real cuando se
// pruebe la integración completa.

import { FacturaXmlInvalidaError, parsearFacturaProveedorXml } from './FacturaProveedorXml';

function facturaValida(lineasXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F001-00012345</cbc:ID>
  <cbc:IssueDate>2026-09-15</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="6">20123456789</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[DISTRIBUIDORA DE COMBUSTIBLES SAC]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="6">20612016527</cbc:ID></cac:PartyIdentification>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="PEN">1550.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineasXml}
</Invoice>`;
}

const LINEA_DIESEL = `
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="GLL">100.000</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">1550.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>DIESEL B5 S-50</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">15.50</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;

const LINEA_ADITIVO = `
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">50.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>ADITIVO LIMPIA INYECTORES</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">25.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;

describe('parsearFacturaProveedorXml', () => {
  it('extrae cabecera y un solo ítem (InvoiceLine sin array)', () => {
    const resultado = parsearFacturaProveedorXml(facturaValida(LINEA_DIESEL));

    expect(resultado).toEqual({
      rucEmisor: '20123456789',
      nombreEmisor: 'DISTRIBUIDORA DE COMBUSTIBLES SAC',
      rucReceptor: '20612016527',
      serieCorrelativo: 'F001-00012345',
      fechaEmision: '2026-09-15',
      moneda: 'PEN',
      importeTotal: 1550,
      items: [{ numeroLinea: '1', descripcion: 'DIESEL B5 S-50', cantidad: 100, unidadMedida: 'GLL', precioUnitario: 15.5, importe: 1550 }],
    });
  });

  it('extrae varios ítems (InvoiceLine como array), cada uno con su propio numeroLinea, y respeta la unidad de medida de cada uno', () => {
    const resultado = parsearFacturaProveedorXml(facturaValida(LINEA_DIESEL + LINEA_ADITIVO));

    expect(resultado.items).toEqual([
      { numeroLinea: '1', descripcion: 'DIESEL B5 S-50', cantidad: 100, unidadMedida: 'GLL', precioUnitario: 15.5, importe: 1550 },
      { numeroLinea: '2', descripcion: 'ADITIVO LIMPIA INYECTORES', cantidad: 2, unidadMedida: 'NIU', precioUnitario: 25, importe: 50 },
    ]);
  });

  it('usa NIU como unidad de medida por defecto si InvoicedQuantity no trae unitCode', () => {
    const lineaSinUnitCode = `
      <cac:InvoiceLine>
        <cbc:InvoicedQuantity>3</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount>30.00</cbc:LineExtensionAmount>
        <cac:Item><cbc:Description>ITEM SIN UNIDAD</cbc:Description></cac:Item>
        <cac:Price><cbc:PriceAmount>10.00</cbc:PriceAmount></cac:Price>
      </cac:InvoiceLine>`;

    const resultado = parsearFacturaProveedorXml(facturaValida(lineaSinUnitCode));

    expect(resultado.items[0]?.unidadMedida).toBe('NIU');
  });

  it('usa el índice 1-based como numeroLinea de respaldo si la línea no trae cbc:ID (UBL lo exige, pero por las dudas)', () => {
    const lineaSinId = `
      <cac:InvoiceLine>
        <cbc:InvocedQuantitySinUsar>ignorado</cbc:InvocedQuantitySinUsar>
        <cbc:InvoicedQuantity unitCode="NIU">1</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount>5.00</cbc:LineExtensionAmount>
        <cac:Item><cbc:Description>ITEM SIN ID DE LINEA</cbc:Description></cac:Item>
        <cac:Price><cbc:PriceAmount>5.00</cbc:PriceAmount></cac:Price>
      </cac:InvoiceLine>`;

    const resultado = parsearFacturaProveedorXml(facturaValida(LINEA_DIESEL + lineaSinId));

    expect(resultado.items[0]?.numeroLinea).toBe('1');
    expect(resultado.items[1]?.numeroLinea).toBe('2'); // índice 1-based (segunda línea), no el "1" de LINEA_DIESEL
  });

  it('rechaza XML mal formado', () => {
    expect(() => parsearFacturaProveedorXml('<Invoice><ID>F001-1</ID><Unclosed>')).toThrow(FacturaXmlInvalidaError);
  });

  it('rechaza texto que no es XML', () => {
    expect(() => parsearFacturaProveedorXml('esto no es un XML para nada')).toThrow(FacturaXmlInvalidaError);
  });

  it('rechaza un comprobante que no es Factura (ej. CreditNote) -- fuera de alcance por ahora', () => {
    expect(() => parsearFacturaProveedorXml('<CreditNote><ID>FC01-1</ID></CreditNote>')).toThrow(FacturaXmlInvalidaError);
  });

  it('rechaza si falta el RUC del proveedor', () => {
    const xmlSinRucEmisor = facturaValida(LINEA_DIESEL).replace(
      '<cac:PartyIdentification><cbc:ID schemeID="6">20123456789</cbc:ID></cac:PartyIdentification>',
      ''
    );
    expect(() => parsearFacturaProveedorXml(xmlSinRucEmisor)).toThrow(FacturaXmlInvalidaError);
  });

  it('rechaza si falta el RUC receptor (no se podría identificar la estación)', () => {
    const xmlSinRucReceptor = facturaValida(LINEA_DIESEL).replace(
      '<cac:PartyIdentification><cbc:ID schemeID="6">20612016527</cbc:ID></cac:PartyIdentification>',
      ''
    );
    expect(() => parsearFacturaProveedorXml(xmlSinRucReceptor)).toThrow(FacturaXmlInvalidaError);
  });

  it('rechaza una factura sin ninguna línea', () => {
    expect(() => parsearFacturaProveedorXml(facturaValida(''))).toThrow(FacturaXmlInvalidaError);
  });

  it('rechaza si el importe total no es numérico', () => {
    const xmlImporteInvalido = facturaValida(LINEA_DIESEL).replace(
      '<cbc:PayableAmount currencyID="PEN">1550.00</cbc:PayableAmount>',
      '<cbc:PayableAmount currencyID="PEN">no-es-un-numero</cbc:PayableAmount>'
    );
    expect(() => parsearFacturaProveedorXml(xmlImporteInvalido)).toThrow(FacturaXmlInvalidaError);
  });
});
