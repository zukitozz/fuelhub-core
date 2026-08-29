// domain/TanqueUpdateInput.ts
//
// Sin dependencias de AWS (sección 4, regla 1). Espejo de `TanqueUpdateInput`
// del contrato OpenAPI (sección 11) — PUT parcial (sección 3.8.3): cualquier
// subconjunto de campos, típicamente `productoId` para reasignar el tanque,
// pero también sirve para ajustar capacidad/stock mínimo/estado.

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface TanqueUpdateInput {
  readonly productoId?: string;
  readonly capacidad?: number;
  readonly stockMinimo?: number | null;
  readonly activo?: boolean;
}

export function validarTanqueUpdate(input: TanqueUpdateInput): void {
  const errores: DetalleValidacion[] = [];

  const tieneAlgunCampo =
    input.productoId !== undefined || input.capacidad !== undefined || input.stockMinimo !== undefined || input.activo !== undefined;
  if (!tieneAlgunCampo) {
    errores.push({ field: 'body', issue: 'debe incluir al menos un campo a actualizar (productoId, capacidad, stockMinimo o activo)' });
  }
  if (input.productoId !== undefined && !input.productoId.trim()) {
    errores.push({ field: 'productoId', issue: 'no puede ser una cadena vacía' });
  }
  if (input.capacidad !== undefined && (typeof input.capacidad !== 'number' || input.capacidad <= 0)) {
    errores.push({ field: 'capacidad', issue: 'debe ser un número > 0' });
  }
  if (input.stockMinimo !== undefined && input.stockMinimo !== null && (typeof input.stockMinimo !== 'number' || input.stockMinimo < 0)) {
    errores.push({ field: 'stockMinimo', issue: 'debe ser un número >= 0 (o null para quitarlo)' });
  }
  if (input.activo !== undefined && typeof input.activo !== 'boolean') {
    errores.push({ field: 'activo', issue: 'debe ser booleano' });
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload de actualización de tanque no pasó la validación.', errores);
  }
}
