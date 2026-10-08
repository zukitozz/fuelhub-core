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
//
// v1.85 -- a partir de ahora, igual que `RegistrarCierreDia.ts`, tras el
// INSERT confirmado se publica el evento `CierreTurnoRegistrado` a
// EventBridge en modo "best effort": si la publicación falla, se loguea pero
// NO se revierte el INSERT ya confirmado ni se propaga el error al cliente
// (mismo criterio documentado en la sección 4.1 para `CierreDiaRegistrado`).

import { AuthContext, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError } from '@fuelhub/shared-kernel';
import type { CierreTurnoDetalleDTO, Turno } from '@fuelhub/shared-kernel';
import { validarCierreTurno, type CierreTurnoInput } from '../../domain/CierreTurnoInput';
import type { CierreTurnoIngestaRepository } from '../ports/CierreTurnoIngestaRepository';
import type { EventPublisherPort } from '../ports/EventPublisherPort';

const PROYECTO_CODIGO = 'FUELHUBCLOUD'; // mismo valor que RegistrarCierreDia.ts -- confirmado v1.57 contra el contrato real de notificaciones-whatsapp

// Texto legible para el campo `tipo` del evento (v1.85) -- notificaciones-whatsapp
// lo muestra tal cual en el mensaje, no es un campo de negocio nuestro.
const TIPO_POR_TURNO: Record<Turno, string> = {
  TURNO1: 'turno 1',
  TURNO2: 'turno 2',
  TURNO3: 'turno 3',
};

export class RegistrarCierreTurno {
  constructor(
    private readonly repo: CierreTurnoIngestaRepository,
    private readonly eventos: EventPublisherPort
  ) {}

  async ejecutar(auth: AuthContext, input: CierreTurnoInput): Promise<CierreTurnoDetalleDTO> {
    validarCierreTurno(input);

    // Autorización por estación (5.4): nunca se confía en que el payload diga
    // la verdad por sí solo — se compara contra `custom:station_scope` del
    // token ya verificado, ANTES de que el adaptador toque la base de datos.
    if (!hasAccessToStation(auth, input.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(input.codigoEstacion);
    }

    const { dto, estacionId } = await this.repo.registrar({ ...input, clienteOrigen: auth.clientId });

    try {
      await this.eventos.publicarCierreTurnoRegistrado({
        proyectoCodigo: PROYECTO_CODIGO,
        estacionId,
        estacionCodigo: dto.codigoEstacion,
        fechaNegocio: dto.fechaNegocio,
        turno: dto.turno,
        tipo: TIPO_POR_TURNO[dto.turno],
        total: dto.total,
        cierreTurnoId: dto.id,
      });
    } catch (errorDePublicacion) {
      // Best effort a propósito (mismo criterio que RegistrarCierreDia.ts):
      // el cierre ya quedó grabado en Postgres, que es la fuente de verdad —
      // una falla de EventBridge no debe convertirse en un 500 para el
      // sistema del grifo que sí cumplió su parte.
      console.error('No se pudo publicar CierreTurnoRegistrado a EventBridge:', errorDePublicacion);
    }

    return dto;
  }
}
