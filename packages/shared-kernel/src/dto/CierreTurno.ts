// packages/shared-kernel/src/dto/CierreTurno.ts
//
// Forma canónica de "cierre de turno" — espejo exacto de los schemas
// `CierreTurnoResumen`/`CierreTurnoDetalleCompleto`/`Pago`/`DetalleLinea` del
// contrato OpenAPI (sección 11, `openapi.yaml`). Vive en shared-kernel (no en
// un solo microservicio) porque `ingest-cierre-turno`, `consulta-cierres` y
// `consulta-cierre-detalle` devuelven/reciben exactamente esta forma — antes
// cada servicio definía su propia copia y una de ellas (consulta-cierre-detalle,
// v1.33) quedó con nombres de campo inventados que no correspondían ni al DDL
// real (sección 3.3) ni a este contrato. Centralizarlo evita que eso se repita.

export type Turno = 'TURNO1' | 'TURNO2' | 'TURNO3';
export type EstadoCierre = 'ACTIVO' | 'ANULADO';
/** Espejo del ENUM Postgres `categoria_producto` (sección 3.3, v1.58) — ver DetalleLinea.categoria. */
export type CategoriaProducto = 'COMBUSTIBLE' | 'NO_COMBUSTIBLE';

/** Espejo de `components.schemas.Pago` — OJO: el campo es `medio`, no `metodoPago`. */
export interface Pago {
  readonly medio: string; // 'EFECTIVO' | 'TARJETA' | 'YAPE' | ... (extensible, sección 3.5)
  readonly monto: number;
}

/**
 * Espejo de `components.schemas.DetalleLinea` (sección 3.8.1.1) — una línea de
 * venta por producto. `productoId` es null cuando el producto no pertenece al
 * catálogo cruzado (balón de gas, mercadito, etc.); en ese caso `codigoLocal`/
 * `producto` son la única identidad disponible.
 */
export interface DetalleLinea {
  readonly productoId: string | null;
  readonly codigoLocal: string | null;
  readonly producto: string;
  readonly medida: string | null;
  readonly totalCantidad: number;
  readonly totalSoles: number;
  readonly calibracionCantidad: number | null;
  readonly calibracionSoles: number | null;
  readonly despachoCantidad: number | null;
  readonly despachoSoles: number | null;
  /**
   * Combustible/no-combustible (v1.58) — `null` cuando la línea no trae
   * `productoId` y nadie mandó el campo explícito al registrar el cierre
   * ("sin clasificar", no un valor adivinado). Ver DetalleLineaInput en
   * `ingest-cierre-turno/domain/CierreTurnoInput.ts` para la regla completa.
   */
  readonly categoria: CategoriaProducto | null;
}

export interface Empleado {
  readonly codigo: string;
  readonly nombre: string;
}

/** Espejo de `components.schemas.CierreTurnoResumen` — forma usada en listados (GET /cierres-turno). */
export interface CierreTurnoResumenDTO {
  readonly id: string;
  readonly codigoEstacion: string;
  readonly isla: string | null;
  readonly turno: Turno;
  readonly fechaNegocio: string;
  readonly fechaInicio: string;
  readonly fecha: string;
  readonly total: number;
  readonly estado: EstadoCierre;
  readonly empleado: Empleado;
  readonly recibidoEn: string;
}

/**
 * Espejo de `components.schemas.CierreTurnoDetalleCompleto` — forma completa
 * devuelta tanto por `GET /cierres-turno/{id}` (consulta-cierre-detalle) como
 * por `POST /cierres-turno` (ingest-cierre-turno, sección 11.2: mismo schema
 * en la respuesta 201/200).
 */
export interface CierreTurnoDetalleDTO extends CierreTurnoResumenDTO {
  readonly cierreDiaId: string | null;
  readonly facturasEmitidas: number;
  readonly clienteOrigen: string;
  readonly pagos: readonly Pago[];
  readonly detalle: readonly DetalleLinea[];
}
