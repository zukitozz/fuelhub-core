// application/use-cases/ProcesarFacturaProveedorCorreo.ts
//
// Orquesta la capacidad nueva completa (v1.81): recibe el XML crudo de una
// factura de proveedor (adjunto de un correo ya identificado por el
// adaptador de Gmail, por construir), y registra UNA compra por cada línea
// de la factura -- mismo criterio "una compra = un producto" que ya usa el
// flujo manual (`POST /compras`).
//
// Orden de pasos (cada uno puede cortar el procesamiento del correo
// COMPLETO, antes de tocar la base -- ver por qué en cada excepción):
//
//   1. Parsea el XML (`parsearFacturaProveedorXml`, dominio puro). Un XML
//      corrupto o de un tipo de comprobante no soportado lanza
//      `FacturaXmlInvalidaError` -- no hay nada que registrar.
//
//   2. Resuelve la estación por el RUC receptor. Si no matchea ninguna,
//      lanza `EstacionNoReconocidaError` -- `compras.estacion_id` es NOT
//      NULL, no hay forma de registrar sin saber a qué estación
//      pertenece.
//
// Ambas excepciones las deja subir tal cual -- el composition root (Lambda
// handler, por construir) es quien decide qué hacer con el correo entero
// (etiqueta de error), no este caso de uso.
//
// A partir de ahí, LÍNEA POR LÍNEA (un fallo en una línea no debe tumbar
// las demás -- una factura con 3 productos donde 1 ya se procesó antes no
// debería re-fallar los otros 2):
//
//   3. Chequeo de idempotencia (`existeComprobante`) -- si ya existe,
//      la línea se marca `DUPLICADA` y se sigue con la próxima, sin tocar
//      la base. Ver nota de cabecera de `CompraCorreoRepository.ts`.
//
//   4. Matchea el producto contra el catálogo (`matchearProducto`,
//      dominio puro). Si matchea, la compra nace `ACTIVO` con
//      `productoId`/`categoria` del catálogo. Si NO matchea (o es
//      ambiguo), nace `PENDIENTE_REVISION` con `productoNombre` = la
//      descripción cruda del XML y `categoria = null` -- Jorge la
//      completa a mano con el `PUT /compras/{id}` que ya existe (sección
//      migración 1788600000000).
//
//   5. Inserta. Si de todas formas choca con el índice único (carrera
//      entre el paso 3 y este INSERT), `registrarCompra` lanza
//      `ComprobanteDuplicadoError` -- se trata igual que el paso 3 (línea
//      `DUPLICADA`), no se propaga como error real.

import { parsearFacturaProveedorXml } from '../../domain/FacturaProveedorXml';
import { EstacionNoReconocidaError } from '../../domain/EstacionNoReconocidaError';
import { matchearProducto } from '../../domain/MatchearProducto';
import {
  ComprobanteDuplicadoError,
  type CompraCorreoRepository,
  type EstadoCompraCorreo,
} from '../ports/CompraCorreoRepository';

export type ResultadoLineaFactura =
  | { readonly numeroLinea: string; readonly resultado: 'REGISTRADA'; readonly compraId: string; readonly estado: EstadoCompraCorreo }
  | { readonly numeroLinea: string; readonly resultado: 'DUPLICADA' };

export interface ResultadoProcesamientoFactura {
  readonly rucEmisor: string;
  readonly numeroComprobante: string;
  readonly lineas: readonly ResultadoLineaFactura[];
}

export class ProcesarFacturaProveedorCorreo {
  constructor(private readonly repo: CompraCorreoRepository) {}

  async ejecutar(xmlContenido: string): Promise<ResultadoProcesamientoFactura> {
    const factura = parsearFacturaProveedorXml(xmlContenido);

    const estacion = await this.repo.buscarEstacionPorRuc(factura.rucReceptor);
    if (!estacion) {
      throw new EstacionNoReconocidaError(factura.rucReceptor);
    }

    const catalogo = await this.repo.listarProductosActivos();

    const lineas: ResultadoLineaFactura[] = [];
    for (const item of factura.items) {
      const yaExiste = await this.repo.existeComprobante(factura.rucEmisor, factura.serieCorrelativo, item.numeroLinea);
      if (yaExiste) {
        lineas.push({ numeroLinea: item.numeroLinea, resultado: 'DUPLICADA' });
        continue;
      }

      const match = matchearProducto(item.descripcion, catalogo);
      const estado: EstadoCompraCorreo = match ? 'ACTIVO' : 'PENDIENTE_REVISION';

      try {
        const { id } = await this.repo.registrarCompra({
          estacionId: estacion.id,
          productoId: match?.id ?? null,
          productoNombre: match?.nombre ?? item.descripcion,
          categoria: match?.categoria ?? null,
          proveedor: factura.nombreEmisor,
          fecha: factura.fechaEmision,
          cantidad: item.cantidad,
          costoUnitario: item.precioUnitario,
          proveedorRuc: factura.rucEmisor,
          numeroComprobante: factura.serieCorrelativo,
          numeroLineaComprobante: item.numeroLinea,
          estado,
        });
        lineas.push({ numeroLinea: item.numeroLinea, resultado: 'REGISTRADA', compraId: id, estado });
      } catch (err) {
        if (err instanceof ComprobanteDuplicadoError) {
          lineas.push({ numeroLinea: item.numeroLinea, resultado: 'DUPLICADA' });
          continue;
        }
        throw err;
      }
    }

    return { rucEmisor: factura.rucEmisor, numeroComprobante: factura.serieCorrelativo, lineas };
  }
}
