// domain/CierreTurnoInput.ts
//
// Sin dependencias de AWS (sección 4, regla 1). Define la forma cruda del
// payload de `POST /cierres-turno` (espejo de `CierreTurnoInput` en el
// contrato OpenAPI, sección 11) y la validación puramente estructural —
// todo lo que se puede verificar sin tocar la base de datos (sección 3.9).
//
// Lo que NO se valida acá porque requiere estado persistido (y por lo tanto
// vive en el adaptador de infraestructura, ver el comentario en
// `PostgresCierreTurnoIngestaRepository.ts`): que `codigoEstacion` exista,
// que cada `productoId` esté en el catálogo activo, y que `empleado.codigo`
// no pertenezca a otra estación.

import { ParametrosInvalidosError, type CategoriaProducto, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface PagoInput {
  readonly medio: string;
  readonly monto: number;
}

export interface DetalleLineaInput {
  readonly productoId?: string | null;
  readonly codigoLocal?: string | null;
  readonly producto: string;
  readonly medida?: string | null;
  readonly totalCantidad: number;
  readonly totalSoles: number;
  readonly calibracionCantidad?: number | null;
  readonly calibracionSoles?: number | null;
  readonly despachoCantidad?: number | null;
  readonly despachoSoles?: number | null;
  /**
   * Clasificación combustible/no-combustible (sección 3.8.1/3.8.2, v1.58) —
   * OPCIONAL. Cuando la línea trae `productoId`, el servidor SIEMPRE resuelve
   * la categoría desde `productos_maestro` e ignora este campo (el catálogo
   * es la fuente de verdad ahí — ver PostgresCierreTurnoIngestaRepository.ts).
   * Solo tiene efecto real cuando no hay `productoId`: ahí, si se omite, la
   * línea queda "sin clasificar" (NULL) en vez de asumida por heurístico.
   */
  readonly categoria?: CategoriaProducto | null;
}

export interface EmpleadoInput {
  readonly codigo: string;
  readonly nombre: string;
}

export interface CierreTurnoInput {
  readonly codigoEstacion: string;
  readonly isla?: string | null;
  readonly turno: string;
  readonly fechaNegocio: string;
  readonly fechaInicio: string;
  readonly fecha: string;
  readonly total: number;
  readonly facturasEmitidas?: number;
  readonly empleado: EmpleadoInput;
  readonly pagos: readonly PagoInput[];
  readonly detalle: readonly DetalleLineaInput[];
}

const TURNOS_VALIDOS = new Set(['TURNO1', 'TURNO2', 'TURNO3']);
const CATEGORIAS_VALIDAS = new Set(['COMBUSTIBLE', 'NO_COMBUSTIBLE']);

/**
 * Valida el payload estructuralmente (sección 3.9) y lanza
 * `ParametrosInvalidosError` con el detalle por campo (misma forma que
 * `components.schemas.Error.details` del contrato OpenAPI) si algo falla.
 * No devuelve un tipo distinto — el input ya viene tipado por
 * `CierreTurnoInput`; esta función solo confirma sus invariantes de negocio.
 */
export function validarCierreTurno(input: CierreTurnoInput): void {
  const errores: DetalleValidacion[] = [];

  if (!TURNOS_VALIDOS.has(input.turno)) {
    errores.push({ field: 'turno', issue: 'debe ser uno de: TURNO1, TURNO2, TURNO3' });
  }

  const fechaInicio = Date.parse(input.fechaInicio);
  const fecha = Date.parse(input.fecha);
  if (Number.isNaN(fechaInicio)) {
    errores.push({ field: 'fechaInicio', issue: 'fecha/hora inválida' });
  }
  if (Number.isNaN(fecha)) {
    errores.push({ field: 'fecha', issue: 'fecha/hora inválida' });
  }
  if (!Number.isNaN(fechaInicio) && !Number.isNaN(fecha) && fecha <= fechaInicio) {
    // sección 3.4.2: CHECK (fecha > fecha_inicio) en el DDL — se valida acá
    // también para devolver un 400 legible en vez de un error crudo de Postgres.
    errores.push({ field: 'fecha', issue: 'debe ser posterior a fechaInicio' });
  }

  if (!input.empleado?.codigo?.trim()) {
    errores.push({ field: 'empleado.codigo', issue: 'requerido' });
  }
  if (!input.empleado?.nombre?.trim()) {
    errores.push({ field: 'empleado.nombre', issue: 'requerido' });
  }

  if (!input.pagos || input.pagos.length === 0) {
    errores.push({ field: 'pagos', issue: 'debe traer al menos un medio de pago' });
  } else {
    input.pagos.forEach((pago, i) => {
      if (!pago.medio?.trim()) errores.push({ field: `pagos[${i}].medio`, issue: 'requerido' });
      if (typeof pago.monto !== 'number' || pago.monto < 0) {
        errores.push({ field: `pagos[${i}].monto`, issue: 'debe ser un número >= 0' });
      }
    });
  }

  if (!input.detalle || input.detalle.length === 0) {
    errores.push({ field: 'detalle', issue: 'debe traer al menos una línea de producto' });
  } else {
    input.detalle.forEach((linea, i) => {
      if (!linea.producto?.trim()) errores.push({ field: `detalle[${i}].producto`, issue: 'requerido' });
      if (!linea.codigoLocal && !linea.productoId) {
        // sección 3.8.1.1: si no hay productoId (catálogo cruzado), codigoLocal
        // es la única referencia — no pueden faltar los dos a la vez.
        errores.push({ field: `detalle[${i}].codigoLocal`, issue: 'requerido cuando no se envía productoId' });
      }
      if (typeof linea.totalCantidad !== 'number') {
        errores.push({ field: `detalle[${i}].totalCantidad`, issue: 'requerido, debe ser numérico' });
      }
      if (typeof linea.totalSoles !== 'number') {
        errores.push({ field: `detalle[${i}].totalSoles`, issue: 'requerido, debe ser numérico' });
      }
      if (linea.categoria != null && !CATEGORIAS_VALIDAS.has(linea.categoria)) {
        errores.push({ field: `detalle[${i}].categoria`, issue: 'debe ser uno de: COMBUSTIBLE, NO_COMBUSTIBLE (u omitirse)' });
      }
    });
  }

  if (typeof input.total !== 'number' || input.total < 0) {
    errores.push({ field: 'total', issue: 'debe ser un número >= 0' });
  }
  if (input.facturasEmitidas !== undefined && (!Number.isInteger(input.facturasEmitidas) || input.facturasEmitidas < 0)) {
    errores.push({ field: 'facturasEmitidas', issue: 'debe ser un entero >= 0' });
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload de cierre de turno no pasó la validación.', errores);
  }
}
