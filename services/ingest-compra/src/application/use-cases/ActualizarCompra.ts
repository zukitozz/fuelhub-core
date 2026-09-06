// application/use-cases/ActualizarCompra.ts
//
// Mismo criterio que ActualizarTanque (admin-tanques, v1.33/v1.65): la
// autorización por estación se aplica DESPUÉS de resolver el recurso por
// `id`, sobre la `codigoEstacion` real de la compra encontrada -- nunca
// sobre un campo del body (acá tampoco existe uno). Así, un `id` de compra
// adivinado o filtrado de otra estación nunca permite modificarlo, solo
// devuelve 403.

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError, RecursoNoEncontradoError } from '@fuelhub/shared-kernel';
import { validarCompraUpdate, type CompraUpdateInput } from '../../domain/CompraUpdateInput';
import type { CompraIngestaRepository, CompraOutputDTO } from '../ports/CompraIngestaRepository';

export class ActualizarCompra {
  constructor(private readonly repo: CompraIngestaRepository) {}

  async ejecutar(auth: AuthContext, id: string, cambios: CompraUpdateInput): Promise<CompraOutputDTO> {
    validarCompraUpdate(cambios);

    const existente = await this.repo.obtenerPorId(id);
    if (!existente) {
      throw new RecursoNoEncontradoError('Compra', id);
    }
    if (!hasAccessToStation(auth, existente.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(existente.codigoEstacion);
    }

    return this.repo.actualizar(id, cambios);
  }
}
