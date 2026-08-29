// application/use-cases/RegistrarCompra.ts
//
// Mismo orden que el resto de los casos de uso de ingesta: validación
// estructural (dominio) → autorización por estación (5.4) → delega al
// puerto. Sin idempotencia (a diferencia de cierres): el propio contrato
// OpenAPI documenta `POST /compras` como no idempotente por header, por bajo
// volumen y sin reintentos automáticos esperados (sección 3.8/11.2) — por
// eso tampoco hay wrapper de Powertools en `handler.ts`.

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError } from '@fuelhub/shared-kernel';
import { validarCompra, type CompraInput } from '../../domain/CompraInput';
import type { CompraIngestaRepository, CompraOutputDTO } from '../ports/CompraIngestaRepository';

export class RegistrarCompra {
  constructor(private readonly repo: CompraIngestaRepository) {}

  async ejecutar(auth: AuthContext, input: CompraInput): Promise<CompraOutputDTO> {
    validarCompra(input);

    if (!hasAccessToStation(auth, input.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(input.codigoEstacion);
    }

    return this.repo.registrar(input);
  }
}
