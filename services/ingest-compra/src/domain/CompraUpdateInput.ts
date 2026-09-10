// domain/CompraUpdateInput.ts
//
// Sin dependencias de AWS (sección 4, regla 1). Espejo de `CompraUpdateInput`
// del contrato OpenAPI (sección 11) -- PUT parcial de una compra ya
// registrada (v1.66, a pedido de Jorge: hoy no había forma de corregir ni
// anular una compra). Mismo criterio que `TanqueUpdateInput`
// (admin-tanques): cualquier subconjunto de campos.
//
// Dos particularidades frente a `TanqueUpdateInput`:
//
//   1. `destinos`, cuando viene, REEMPLAZA TODO el reparto/entregas de la
//      compra -- no es un merge fila por fila. Para agregar, quitar o
//      corregir un destino, el cliente manda la lista COMPLETA resultante
//      (mismo criterio que ya usa el propio `POST /compras` -- ver
//      `CompraInput.ts`). Es la forma más simple de cubrir "agregar,
//     eliminar o editar" con un solo campo, sin necesitar sub-rutas para
//     cada destino individual. Cada elemento sigue la misma regla XOR
//     (`tanqueId` O `descripcionEntrega`, v1.70) que `CompraInput.ts` --
//     ver `validarDestino`, compartida entre los dos archivos.
//
//   2. `estado` deja anular una compra (`'ANULADO'`) sin borrarla --
//     confirmado con Jorge: se prefiere mantener el historial completo para
//     auditoría (mismo criterio que `cierres_dia`/`cierres_turno`) en vez
//     de un DELETE físico. Reutiliza el mismo ENUM `estado_cierre`.
//
//   La validación "la suma de destinos no puede superar la cantidad" NO se
//   hace acá cuando `cantidad` no viene en este mismo payload (regla 1 --
//   sin acceso a la cantidad vigente de la compra) -- eso lo valida el
//   adaptador, que sí tiene la cantidad real dentro de la misma transacción
//   (`PostgresCompraIngestaRepository.actualizar`).

import { ParametrosInvalidosError, type CategoriaProducto, type DetalleValidacion, type EstadoCierre } from '@fuelhub/shared-kernel';
import { validarDestino, type CompraDestinoInput } from './CompraInput';

export interface CompraUpdateInput {
  readonly productoId?: string | null;
  readonly productoNombre?: string;
  readonly categoria?: CategoriaProducto | null;
  readonly proveedor?: string | null;
  readonly fecha?: string;
  readonly cantidad?: number;
  readonly costoUnitario?: number;
  readonly numeroGuia?: string | null;
  /** Reemplaza TODO el reparto/entregas de la compra (v1.66, extendido v1.70). Ver nota de cabecera, punto 1. */
  readonly destinos?: readonly CompraDestinoInput[];
  /** Anular/reactivar (v1.66) -- ver nota de cabecera, punto 2. */
  readonly estado?: EstadoCierre;
}

export function validarCompraUpdate(input: CompraUpdateInput): void {
  const errores: DetalleValidacion[] = [];

  const tieneAlgunCampo =
    input.productoId !== undefined ||
    input.productoNombre !== undefined ||
    input.categoria !== undefined ||
    input.proveedor !== undefined ||
    input.fecha !== undefined ||
    input.cantidad !== undefined ||
    input.costoUnitario !== undefined ||
    input.numeroGuia !== undefined ||
    input.destinos !== undefined ||
    input.estado !== undefined;

  if (!tieneAlgunCampo) {
    errores.push({ field: 'body', issue: 'debe incluir al menos un campo a actualizar' });
  }

  if (input.productoId === null) {
    // Mismo criterio que POST /compras (CompraInput.ts): sin productoId, productoNombre/categoria son obligatorios.
    if (!input.productoNombre?.trim()) {
      errores.push({ field: 'productoNombre', issue: 'requerido al quitar productoId (productoId: null)' });
    }
    if (!input.categoria) {
      errores.push({ field: 'categoria', issue: 'requerido al quitar productoId (productoId: null)' });
    }
  }

  if (input.fecha !== undefined && Number.isNaN(Date.parse(input.fecha))) {
    errores.push({ field: 'fecha', issue: 'fecha/hora inválida' });
  }
  if (input.cantidad !== undefined && (typeof input.cantidad !== 'number' || input.cantidad <= 0)) {
    errores.push({ field: 'cantidad', issue: 'debe ser un número > 0' });
  }
  if (input.costoUnitario !== undefined && (typeof input.costoUnitario !== 'number' || input.costoUnitario <= 0)) {
    errores.push({ field: 'costoUnitario', issue: 'debe ser un número > 0' });
  }
  if (input.estado !== undefined && input.estado !== 'ACTIVO' && input.estado !== 'ANULADO') {
    errores.push({ field: 'estado', issue: 'debe ser ACTIVO o ANULADO' });
  }

  if (input.destinos !== undefined) {
    input.destinos.forEach((destino, i) => validarDestino(destino, i, errores));

    // Solo se puede validar contra `cantidad` acá si esta misma actualización
    // también la está cambiando -- si no, el adaptador la valida contra la
    // cantidad vigente en la base (ver nota de cabecera).
    if (input.cantidad !== undefined) {
      const sumaDestinos = input.destinos.reduce((acc, d) => acc + (typeof d.cantidad === 'number' ? d.cantidad : 0), 0);
      if (sumaDestinos > input.cantidad) {
        errores.push({
          field: 'destinos',
          issue: `la suma de las cantidades repartidas a tanques (${sumaDestinos}) no puede superar la cantidad comprada (${input.cantidad})`,
        });
      }
    }
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload de actualización de compra no pasó la validación.', errores);
  }
}
