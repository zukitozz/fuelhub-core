// application/use-cases/ListarTanques.ts
//
// Mismo patrón de autorización que ListarCierresTurno (sección 5.4): si no
// viene `estacionCodigo` explícito, se usa la estación única del token
// (caso normal, un App Client por estación); si viene, debe estar autorizada.

import { AuthContext, estacionUnicaDelToken, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError } from '@fuelhub/shared-kernel';
import type { TanqueDTO, TanqueRepository } from '../ports/TanqueRepository';

export class ListarTanques {
  constructor(private readonly repo: TanqueRepository) {}

  async ejecutar(auth: AuthContext, estacionCodigoQuery?: string): Promise<TanqueDTO[]> {
    const estacionCodigo = estacionCodigoQuery ?? estacionUnicaDelToken(auth);

    if (estacionCodigo !== undefined && !hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    return this.repo.listar(estacionCodigo);
  }
}
