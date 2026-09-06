// application/use-cases/ObtenerCompra.ts
//
// GET /compras/{id} (v1.67) -- mismo criterio que `ObtenerCierreTurnoDetalle`
// (consulta-cierre-detalle): la autorización por estación (sección 5.4) se
// aplica DESPUÉS de resolver el recurso por id, sobre `codigoEstacion` del
// registro encontrado -- nunca sobre un query param, porque no existe uno
// acá. Así, un id válido de otra estación nunca llega a devolver su
// contenido, solo un 403, sin importar si se obtuvo adivinando o de un
// listado ajeno.
//
// Reusa `CompraIngestaRepository.obtenerPorId`, ya existente desde v1.66
// para el flujo interno de `PUT /compras/{id}` -- no hay lógica de acceso a
// datos nueva, solo se expone como operación de lectura pública.

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError, RecursoNoEncontradoError } from '@fuelhub/shared-kernel';
import type { CompraIngestaRepository, CompraOutputDTO } from '../ports/CompraIngestaRepository';

export class ObtenerCompra {
  constructor(private readonly repo: CompraIngestaRepository) {}

  async ejecutar(auth: AuthContext, id: string): Promise<CompraOutputDTO> {
    const compra = await this.repo.obtenerPorId(id);

    if (compra === undefined) {
      throw new RecursoNoEncontradoError('Compra', id);
    }

    if (!hasAccessToStation(auth, compra.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(compra.codigoEstacion);
    }

    return compra;
  }
}
