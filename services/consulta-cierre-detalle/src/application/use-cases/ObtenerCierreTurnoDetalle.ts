// application/use-cases/ObtenerCierreTurnoDetalle.ts
//
// Diferencia clave frente a los casos de uso de consulta-cierres: acá la
// autorización por estación (sección 5.4) se aplica DESPUÉS de resolver el
// recurso por id, sobre `codigoEstacion` del registro encontrado — nunca
// sobre un query param, porque no existe uno: el único identificador de
// entrada es el `id` del path, y no debe ser posible usar un id adivinado
// o filtrado de otra estación para leer datos fuera del `station_scope`
// del token.

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError, RecursoNoEncontradoError } from '@fuelhub/shared-kernel';
import type { CierreTurnoDetalleDTO, CierreTurnoDetalleRepository } from '../ports/CierreTurnoDetalleRepository';

export class ObtenerCierreTurnoDetalle {
  constructor(private readonly repo: CierreTurnoDetalleRepository) {}

  async ejecutar(auth: AuthContext, id: string): Promise<CierreTurnoDetalleDTO> {
    const cierre = await this.repo.obtenerPorId(id);

    if (cierre === undefined) {
      throw new RecursoNoEncontradoError('Cierre de turno', id);
    }

    // Autorización recién acá, sobre el dato ya resuelto (sección 5.4) — así
    // un id válido de otra estación nunca llega a devolver su contenido,
    // solo un 403, sin importar si el cliente lo obtuvo adivinando o de un
    // listado ajeno.
    if (!hasAccessToStation(auth, cierre.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(cierre.codigoEstacion);
    }

    return cierre;
  }
}
