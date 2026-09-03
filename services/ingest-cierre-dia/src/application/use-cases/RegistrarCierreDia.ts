// application/use-cases/RegistrarCierreDia.ts
//
// Mismo orden que RegistrarCierreTurno: validación estructural → autorización
// por estación (5.4, nunca delegada a infraestructura) → el puerto de
// ingesta resuelve el resto. La diferencia frente a ingest-cierre-turno: tras
// el INSERT confirmado, se publica el evento `CierreDiaRegistrado` a
// EventBridge (sección 4.1) — en modo "best effort": si la publicación falla,
// se loguea pero NO se revierte el INSERT ya confirmado ni se propaga el
// error al cliente (documentado explícitamente así en la sección 4.1: la
// confiabilidad de la entrega del evento — reintentos/DLQ — queda para la
// Parte 2, sección 7).

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError } from '@fuelhub/shared-kernel';
import type { CierreDiaResumenDTO } from '@fuelhub/shared-kernel';
import { validarCierreDia, type CierreDiaInput } from '../../domain/CierreDiaInput';
import type { CierreDiaIngestaRepository } from '../ports/CierreDiaIngestaRepository';
import type { EventPublisherPort } from '../ports/EventPublisherPort';

const PROYECTO_CODIGO = 'FUELHUBCLOUD'; // confirmado v1.57 contra el contrato real de notificaciones-whatsapp — ver EventPublisherPort.ts

export class RegistrarCierreDia {
  constructor(
    private readonly repo: CierreDiaIngestaRepository,
    private readonly eventos: EventPublisherPort
  ) {}

  async ejecutar(auth: AuthContext, input: CierreDiaInput): Promise<CierreDiaResumenDTO> {
    validarCierreDia(input);

    if (!hasAccessToStation(auth, input.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(input.codigoEstacion);
    }

    const { dto, estacionId } = await this.repo.registrar({ ...input, clienteOrigen: auth.clientId });

    try {
      await this.eventos.publicarCierreDiaRegistrado({
        proyectoCodigo: PROYECTO_CODIGO,
        estacionId,
        estacionCodigo: dto.codigoEstacion,
        fechaNegocio: dto.fechaNegocio,
        total: dto.total,
        cierreDiaId: dto.id,
      });
    } catch (errorDePublicacion) {
      // Best effort a propósito (sección 4.1): el cierre ya quedó grabado en
      // Postgres, que es la fuente de verdad — una falla de EventBridge no
      // debe convertirse en un 500 para el sistema del grifo que sí cumplió
      // su parte. Queda en CloudWatch Logs para investigar/reintentar manual.
      console.error('No se pudo publicar CierreDiaRegistrado a EventBridge:', errorDePublicacion);
    }

    return dto;
  }
}
