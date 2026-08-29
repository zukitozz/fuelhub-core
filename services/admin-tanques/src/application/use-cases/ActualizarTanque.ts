// application/use-cases/ActualizarTanque.ts
//
// Mismo criterio que ObtenerCierreTurnoDetalle (consulta-cierre-detalle,
// v1.33): la autorización por estación se aplica DESPUÉS de resolver el
// recurso por `id`, sobre la `codigoEstacion` real del tanque encontrado —
// nunca sobre un query param, porque acá tampoco existe uno. Así, un `id` de
// tanque adivinado o filtrado de otra estación nunca permite modificarlo,
// solo devuelve 403.

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError, RecursoNoEncontradoError } from '@fuelhub/shared-kernel';
import { validarTanqueUpdate, type TanqueUpdateInput } from '../../domain/TanqueUpdateInput';
import type { TanqueDTO, TanqueRepository } from '../ports/TanqueRepository';

export class ActualizarTanque {
  constructor(private readonly repo: TanqueRepository) {}

  async ejecutar(auth: AuthContext, id: string, cambios: TanqueUpdateInput): Promise<TanqueDTO> {
    validarTanqueUpdate(cambios);

    const existente = await this.repo.obtenerPorId(id);
    if (!existente) {
      throw new RecursoNoEncontradoError('Tanque', id);
    }
    if (!hasAccessToStation(auth, existente.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(existente.codigoEstacion);
    }

    return this.repo.actualizar(id, cambios);
  }
}
