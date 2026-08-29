// domain/CompraInput.ts
//
// Sin dependencias de AWS (sección 4, regla 1). Espejo de `CompraInput` del
// contrato OpenAPI (sección 11) + validación estructural pura. A diferencia
// de `cierres_turno_detalle`, acá `productoId` es SIEMPRE obligatorio
// (sección 3.8.1: las compras son siempre de combustible, nunca de un
// producto fuera del catálogo cruzado).

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface CompraInput {
  readonly codigoEstacion: string;
  readonly tanqueId?: string | null;
  readonly productoId: string;
  readonly proveedor?: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly numeroGuia?: string | null;
}

export function validarCompra(input: CompraInput): void {
  const errores: DetalleValidacion[] = [];

  if (!input.codigoEstacion?.trim()) {
    errores.push({ field: 'codigoEstacion', issue: 'requerido' });
  }
  if (!input.productoId?.trim()) {
    errores.push({ field: 'productoId', issue: 'requerido — a diferencia del detalle de cierre, acá siempre es obligatorio (sección 3.8.1)' });
  }
  if (!input.fecha || Number.isNaN(Date.parse(input.fecha))) {
    errores.push({ field: 'fecha', issue: 'fecha/hora inválida' });
  }
  if (typeof input.cantidad !== 'number' || input.cantidad <= 0) {
    errores.push({ field: 'cantidad', issue: 'debe ser un número > 0' });
  }
  if (typeof input.costoUnitario !== 'number' || input.costoUnitario <= 0) {
    errores.push({ field: 'costoUnitario', issue: 'debe ser un número > 0' });
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload de compra no pasó la validación.', errores);
  }
}
