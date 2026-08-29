// domain/CierreDiaInput.ts
//
// Sin dependencias de AWS (sección 4, regla 1). Espejo de `CierreDiaInput`
// del contrato OpenAPI (sección 11) + validación estructural pura — mismo
// criterio que `ingest-cierre-turno/domain/CierreTurnoInput.ts`, pero un
// payload mucho más simple: sin `pagos`/`detalle`, sin `turno`.

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface AdministradorInput {
  readonly codigo: string;
  readonly nombre: string;
}

export interface CierreDiaInput {
  readonly codigoEstacion: string;
  readonly isla?: string | null;
  readonly fechaNegocio: string;
  readonly fecha: string;
  readonly total: number;
  readonly administrador: AdministradorInput;
}

/**
 * Valida el payload estructuralmente (espejo de `CierreDiaInput` en
 * `openapi.yaml`) y lanza `ParametrosInvalidosError` con `details` por campo
 * si algo falla. No valida `codigoEstacion` contra la base — eso ocurre en
 * el adaptador (ver el comentario en `CierreDiaIngestaRepository.ts`).
 */
export function validarCierreDia(input: CierreDiaInput): void {
  const errores: DetalleValidacion[] = [];

  if (!input.codigoEstacion?.trim()) {
    errores.push({ field: 'codigoEstacion', issue: 'requerido' });
  }
  if (!input.fechaNegocio || Number.isNaN(Date.parse(input.fechaNegocio))) {
    errores.push({ field: 'fechaNegocio', issue: 'fecha inválida (formato YYYY-MM-DD)' });
  }
  if (!input.fecha || Number.isNaN(Date.parse(input.fecha))) {
    errores.push({ field: 'fecha', issue: 'fecha/hora inválida' });
  }
  if (typeof input.total !== 'number' || input.total < 0) {
    errores.push({ field: 'total', issue: 'debe ser un número >= 0' });
  }
  if (!input.administrador?.codigo?.trim()) {
    errores.push({ field: 'administrador.codigo', issue: 'requerido' });
  }
  if (!input.administrador?.nombre?.trim()) {
    errores.push({ field: 'administrador.nombre', issue: 'requerido' });
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload de cierre de día no pasó la validación.', errores);
  }
}
