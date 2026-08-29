// packages/shared-kernel/src/errors.ts
//
// Errores base de dominio/aplicación, compartidos entre microservicios
// (sección 6.3) — cada `handler.ts` los mapea a la forma de error uniforme
// del contrato OpenAPI (sección 11.1: `{ error, message, details? }`).

export class RecursoNoEncontradoError extends Error {
  constructor(recurso: string, id: string) {
    super(`${recurso} no encontrado: ${id}`);
    this.name = 'RecursoNoEncontradoError';
  }
}

export class AccesoDenegadoEstacionError extends Error {
  constructor(public readonly estacionSolicitada: string) {
    super(
      `El token no tiene acceso a la estación "${estacionSolicitada}" (custom:station_scope no la incluye — sección 5.4).`
    );
    this.name = 'AccesoDenegadoEstacionError';
  }
}

export interface DetalleValidacion {
  readonly field: string;
  readonly issue: string;
}

export class ParametrosInvalidosError extends Error {
  constructor(message: string, public readonly details?: readonly DetalleValidacion[]) {
    super(message);
    this.name = 'ParametrosInvalidosError';
  }
}
