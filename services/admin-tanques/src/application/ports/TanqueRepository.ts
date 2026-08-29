// application/ports/TanqueRepository.ts
//
// Un solo puerto para las 2 operaciones que expone este Lambda (GET/PUT,
// sección 3.8.4 — sin alta vía API, los tanques se precargan) — están lo
// bastante relacionadas (mismo agregado `tanques`) como para no fragmentar
// en 2 puertos separados, mismo criterio que se usó en consulta-cierres para
// las 2 rutas de listado que comparte un Lambda.

export interface TanqueDTO {
  readonly id: string;
  readonly codigoEstacion: string;
  readonly productoId: string;
  readonly nombre: string;
  readonly capacidad: number;
  readonly stockMinimo: number | null;
  readonly productoAsignadoEn: string;
  readonly activo: boolean;
  readonly creadoEn: string;
}

export interface CambiosTanque {
  readonly productoId?: string;
  readonly capacidad?: number;
  readonly stockMinimo?: number | null;
  readonly activo?: boolean;
}

export interface TanqueRepository {
  /** Sin `estacionCodigo`, devuelve los tanques de todas las estaciones visibles para el token (uso cross-estación, sección 3.7.1). */
  listar(estacionCodigo?: string): Promise<TanqueDTO[]>;

  obtenerPorId(id: string): Promise<TanqueDTO | undefined>;

  /**
   * Actualiza solo los campos presentes en `cambios`. Si `productoId` cambia,
   * el adaptador actualiza `producto_asignado_en` a la hora del request
   * (sección 3.8.3). Lanza `ParametrosInvalidosError` si el `productoId`
   * nuevo no existe en el catálogo activo.
   */
  actualizar(id: string, cambios: CambiosTanque): Promise<TanqueDTO>;
}
