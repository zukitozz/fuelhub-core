// ProcesarFacturaProveedorCorreo.test.ts
//
// `CompraCorreoRepository` fake en memoria (mismo criterio que el resto del
// repo -- casos de uso se prueban con Jest puro, sin mocks de AWS, gracias
// al límite hexagonal -- ver jest.config.mjs).

import { FacturaXmlInvalidaError } from '../../domain/FacturaProveedorXml';
import { EstacionNoReconocidaError } from '../../domain/EstacionNoReconocidaError';
import {
  ComprobanteDuplicadoError,
  type CompraCorreoRepository,
  type ConfiguracionCorreoEstacion,
  type DatosCompraCorreoAInsertar,
  type EstacionPorRuc,
  type ProductoActivo,
} from '../ports/CompraCorreoRepository';
import { ProcesarFacturaProveedorCorreo } from './ProcesarFacturaProveedorCorreo';

const CATALOGO: readonly ProductoActivo[] = [
  { id: 'id-diesel', nombre: 'Diésel', alias: 'db50', categoria: 'COMBUSTIBLE' },
  { id: 'id-regular', nombre: 'Regular', alias: null, categoria: 'COMBUSTIBLE' },
];

const ESTACION: EstacionPorRuc = { id: 'id-chancayllo', codigo: 'CHANCAYLLO' };

function facturaXml(lineasXml: string, rucReceptor = '20612016527'): string {
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
      <cac:PartyLegalEntity><cbc:RegistrationName>DISTRIBUIDORA XYZ SAC</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">${rucReceptor}</cbc:ID></cac:PartyIdentification></cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="PEN">1550.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
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

const LINEA_REGULAR = `
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="GLL">50.000</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">800.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>GASOHOL REGULAR 90</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">16.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;

const LINEA_SIN_MATCH = `
  <cac:InvoiceLine>
    <cbc:ID>3</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">6</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">30.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>GALLETAS SODA FIELD X 6 UND</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">5.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;

class RepoFake implements CompraCorreoRepository {
  contadorId = 0;
  comprobantesExistentes = new Set<string>(); // `${ruc}|${numero}|${linea}`
  estacion: EstacionPorRuc | undefined = ESTACION;
  catalogo: readonly ProductoActivo[] = CATALOGO;
  lanzarDuplicadoEnRegistrar = false;
  llamadasListarCatalogo = 0;
  compras: DatosCompraCorreoAInsertar[] = [];

  async buscarEstacionPorRuc(): Promise<EstacionPorRuc | undefined> {
    return this.estacion;
  }

  async listarProductosActivos(): Promise<readonly ProductoActivo[]> {
    this.llamadasListarCatalogo += 1;
    return this.catalogo;
  }

  async existeComprobante(proveedorRuc: string, numeroComprobante: string, numeroLineaComprobante: string): Promise<boolean> {
    return this.comprobantesExistentes.has(`${proveedorRuc}|${numeroComprobante}|${numeroLineaComprobante}`);
  }

  async registrarCompra(datos: DatosCompraCorreoAInsertar): Promise<{ id: string }> {
    if (this.lanzarDuplicadoEnRegistrar) {
      throw new ComprobanteDuplicadoError(datos.proveedorRuc, datos.numeroComprobante, datos.numeroLineaComprobante);
    }
    this.compras.push(datos);
    this.contadorId += 1;
    return { id: `compra-${this.contadorId}` };
  }

  async listarConfiguracionesCorreoActivas(): Promise<readonly ConfiguracionCorreoEstacion[]> {
    // No lo usa `ProcesarFacturaProveedorCorreo` (eso lo consume `handler.ts`
    // directamente) -- solo está acá para que `RepoFake` siga cumpliendo la
    // interfaz completa del puerto.
    return [];
  }
}

describe('ProcesarFacturaProveedorCorreo', () => {
  it('registra una factura de una sola línea que matchea el catálogo -- ACTIVO', async () => {
    const repo = new RepoFake();
    const caso = new ProcesarFacturaProveedorCorreo(repo);

    const resultado = await caso.ejecutar(facturaXml(LINEA_DIESEL));

    expect(resultado.lineas).toEqual([{ numeroLinea: '1', resultado: 'REGISTRADA', compraId: 'compra-1', estado: 'ACTIVO' }]);
    expect(repo.compras[0]).toMatchObject({
      estacionId: 'id-chancayllo',
      productoId: 'id-diesel',
      productoNombre: 'Diésel',
      categoria: 'COMBUSTIBLE',
      proveedorRuc: '20123456789',
      numeroComprobante: 'F001-00012345',
      numeroLineaComprobante: '1',
      estado: 'ACTIVO',
    });
  });

  it('registra una línea que NO matchea ningún producto -- PENDIENTE_REVISION, con la descripción cruda', async () => {
    const repo = new RepoFake();
    const caso = new ProcesarFacturaProveedorCorreo(repo);

    const resultado = await caso.ejecutar(facturaXml(LINEA_SIN_MATCH));

    expect(resultado.lineas).toEqual([{ numeroLinea: '3', resultado: 'REGISTRADA', compraId: 'compra-1', estado: 'PENDIENTE_REVISION' }]);
    expect(repo.compras[0]).toMatchObject({
      productoId: null,
      productoNombre: 'GALLETAS SODA FIELD X 6 UND',
      categoria: null,
      estado: 'PENDIENTE_REVISION',
    });
  });

  it('registra UNA compra por cada línea de una factura multi-producto, leyendo el catálogo una sola vez', async () => {
    const repo = new RepoFake();
    const caso = new ProcesarFacturaProveedorCorreo(repo);

    const resultado = await caso.ejecutar(facturaXml(LINEA_DIESEL + LINEA_REGULAR));

    expect(resultado.lineas).toHaveLength(2);
    expect(resultado.lineas.map((l) => l.numeroLinea)).toEqual(['1', '2']);
    expect(repo.compras).toHaveLength(2);
    expect(repo.compras[1]).toMatchObject({ productoId: 'id-regular', numeroLineaComprobante: '2' });
    expect(repo.llamadasListarCatalogo).toBe(1);
  });

  it('no reinserta una línea que ya existe -- la marca DUPLICADA sin llamar a registrarCompra', async () => {
    const repo = new RepoFake();
    repo.comprobantesExistentes.add('20123456789|F001-00012345|1');
    const caso = new ProcesarFacturaProveedorCorreo(repo);

    const resultado = await caso.ejecutar(facturaXml(LINEA_DIESEL));

    expect(resultado.lineas).toEqual([{ numeroLinea: '1', resultado: 'DUPLICADA' }]);
    expect(repo.compras).toHaveLength(0);
  });

  it('trata un choque de carrera contra el índice único (ComprobanteDuplicadoError) igual que una duplicada -- no lo propaga', async () => {
    const repo = new RepoFake();
    repo.lanzarDuplicadoEnRegistrar = true;
    const caso = new ProcesarFacturaProveedorCorreo(repo);

    const resultado = await caso.ejecutar(facturaXml(LINEA_DIESEL));

    expect(resultado.lineas).toEqual([{ numeroLinea: '1', resultado: 'DUPLICADA' }]);
  });

  it('lanza EstacionNoReconocidaError si el RUC receptor no matchea ninguna estación -- no registra nada', async () => {
    const repo = new RepoFake();
    repo.estacion = undefined;
    const caso = new ProcesarFacturaProveedorCorreo(repo);

    await expect(caso.ejecutar(facturaXml(LINEA_DIESEL))).rejects.toThrow(EstacionNoReconocidaError);
    expect(repo.compras).toHaveLength(0);
    expect(repo.llamadasListarCatalogo).toBe(0);
  });

  it('propaga FacturaXmlInvalidaError para un XML corrupto -- no llega a tocar el repositorio', async () => {
    const repo = new RepoFake();
    const caso = new ProcesarFacturaProveedorCorreo(repo);

    await expect(caso.ejecutar('esto no es XML')).rejects.toThrow(FacturaXmlInvalidaError);
    expect(repo.llamadasListarCatalogo).toBe(0);
  });
});
