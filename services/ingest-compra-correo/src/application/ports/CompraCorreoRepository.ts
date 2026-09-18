// application/ports/CompraCorreoRepository.ts
//
// Puerto de persistencia para el caso de uso `ProcesarFacturaProveedorCorreo`
// (por construir) -- separado del `CompraIngestaRepository` del servicio
// `ingest-compra` (flujo manual, `POST/PUT /compras`) a propósito: mismo
// criterio de aislamiento hexagonal por servicio que ya usa el resto del
// repo (ej. `ingest-cierre-dia`/`ingest-cierre-turno` tienen cada uno su
// propio adaptador Postgres aunque escriban tablas relacionadas) -- este
// Lambda nuevo es su propio deployable, no importa código de otro servicio.
//
// Cuatro operaciones, en el orden en que las usa el caso de uso:
//
//   1. `buscarEstacionPorRuc`: resuelve qué estación del grupo recibió la
//      factura, a partir de `AccountingCustomerParty/Party/PartyIdentification/ID`
//      del XML (`estaciones.ruc`, completado en la migración
//      1787950000000 para las 4 estaciones reales de "nonato"). Si no
//      matchea ninguna, el caso de uso NO puede registrar nada --
//      `estacion_id` es NOT NULL en `compras` y no existe un "sin
//      estación" -- lo trata como falla de procesamiento (mismo balde que
//      un XML corrupto: el Lambda le pone la etiqueta de error al correo
//      para que Jorge lo revise a mano).
//
//   2. `listarProductosActivos`: trae el catálogo completo (`productos_maestro`,
//      5 filas hoy) UNA vez por factura -- se lo pasa el caso de uso a
//      `matchearProducto` (dominio, función pura) por cada línea, en vez de
//      resolver producto por producto contra la base como hace
//      `PostgresCompraIngestaRepository.resolverProducto` (ahí el cliente
//      ya manda un `productoId` conocido; acá hay que ADIVINAR cuál es a
//      partir de texto libre, así que hace falta el catálogo completo).
//
//   3. `existeComprobante`: chequeo de idempotencia ANTES de insertar --
//      ver nota de cabecera de la migración 1788600000000 (el índice único
//      parcial es la garantía real; este chequeo evita el roundtrip de
//      INSERT fallido en el caso común de reprocesar por una etiqueta de
//      Gmail desincronizada).
//
//   4. `registrarCompra`: UN INSERT por línea de factura (mismo criterio
//      "una compra = un producto" que ya usa el flujo manual) -- con
//      `origen = 'CORREO'` y los tres campos de idempotencia siempre
//      presentes (a diferencia del flujo manual, donde son opcionales).
//      Si el INSERT choca con el índice único de todas formas (ventana de
//      carrera entre el chequeo del paso 3 y este INSERT -- dos corridas
//      del Lambda solapadas, por ejemplo), el adaptador debe traducir el
//      `23505` de Postgres en `ComprobanteDuplicadoError` (mismo criterio
//      de "la base también lo garantiza, no solo la aplicación" que ya
//      documenta esa migración) -- el caso de uso lo trata igual que un
//      `existeComprobante` que hubiera dado `true`.

import type { CategoriaProducto } from '@fuelhub/shared-kernel';

/** Solo los dos estados que este flujo puede escribir al crear -- una compra por correo nunca nace ANULADO. */
export type EstadoCompraCorreo = 'ACTIVO' | 'PENDIENTE_REVISION';

export interface EstacionPorRuc {
  readonly id: string;
  readonly codigo: string;
}

export interface ProductoActivo {
  readonly id: string;
  readonly nombre: string;
  readonly alias: string | null;
  readonly categoria: CategoriaProducto;
}

export interface DatosCompraCorreoAInsertar {
  readonly estacionId: string;
  /** `null` cuando `matchearProducto` no encontró (o encontró ambiguo) -- ver MatchearProducto.ts. */
  readonly productoId: string | null;
  /** Nombre del catálogo si matcheó; si no, la descripción cruda del XML tal cual (para que Jorge vea qué decía la factura al revisar). */
  readonly productoNombre: string;
  /** `null` cuando no matcheó -- Jorge la completa a mano junto con `productoId` al revisar (PUT /compras/{id}, ya existente). */
  readonly categoria: CategoriaProducto | null;
  readonly proveedor: string;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly proveedorRuc: string;
  readonly numeroComprobante: string;
  readonly numeroLineaComprobante: string;
  readonly estado: EstadoCompraCorreo;
}

/** Lanzado por `registrarCompra` si el INSERT choca con el índice único (carrera con `existeComprobante`, ver cabecera). */
export class ComprobanteDuplicadoError extends Error {
  constructor(proveedorRuc: string, numeroComprobante: string, numeroLineaComprobante: string) {
    super(`Ya existe una compra registrada para proveedorRuc=${proveedorRuc} numeroComprobante=${numeroComprobante} numeroLineaComprobante=${numeroLineaComprobante}.`);
    this.name = 'ComprobanteDuplicadoError';
  }
}

export interface CompraCorreoRepository {
  buscarEstacionPorRuc(ruc: string): Promise<EstacionPorRuc | undefined>;
  listarProductosActivos(): Promise<readonly ProductoActivo[]>;
  existeComprobante(proveedorRuc: string, numeroComprobante: string, numeroLineaComprobante: string): Promise<boolean>;
  /** Lanza `ComprobanteDuplicadoError` -- ver cabecera, punto 4. */
  registrarCompra(datos: DatosCompraCorreoAInsertar): Promise<{ id: string }>;
}
