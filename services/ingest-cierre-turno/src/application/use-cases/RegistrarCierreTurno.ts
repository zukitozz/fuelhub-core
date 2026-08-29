// application/use-cases/RegistrarCierreTurno.ts
//
// Orquesta el registro de un cierre de turno (sección 4). El orden importa:
// primero la validación estructural pura (dominio, sin tocar la BD), después
// la autorización por estación (5.4) — la única decisión de negocio que este
// caso de uso nunca delega al repositorio — y recién al final se llama al
// puerto, que resuelve el resto (estación/productos/empleado) de forma
// atómica junto con el INSERT (ver el comentario en el puerto).
//
// La idempotencia (`Idempotency-Key`, sección 2.3) NO aparece acá — es
// deliberado: es una utilidad de infraestructura (deduplicación de requests
// HTTP), no parte del modelo de negocio, así que se resuelve envolviendo el
// handler completo con Lambda Powertools (`handler.ts`), no en este caso de uso.

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError } from '@fuelhub/shared-kernel';
import type { CierreTurnoDetalleDTO } from '@fuelhub/shared-kernel';
import { validarCierreTurno, type CierreTurnoInput } from '../../domain/CierreTurnoInput';
import type { CierreTurnoIngestaRepository } from '../ports/CierreTurnoIngestaRepository';

export class RegistrarCierreTurno {
  constructor(private readonly repo: CierreTurnoIngestaRepository) {}

  async ejecutar(auth: AuthContext, input: CierreTurnoInput): Promise<CierreTurnoDetalleDTO> {
    validarCierreTurno(input);

    // Autorización por estación (5.4): nunca se confía en que el payload diga
    // la verdad por sí solo — se compara contra `custom:station_scope` del
    // token ya verificado, ANTES de que el adaptador toque la base de datos.
    if (!hasAccessToStation(auth, input.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(input.codigoEstacion);
    }

    return this.repo.registrar({ ...input, clienteOrigen: auth.clientId });
  }
}
