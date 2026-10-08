// application/use-cases/GenerarReporteTurnoDocumento.ts
//
// v1.85 -- calco de GenerarReporteDiaDocumento.ts, disparado por el evento
// `CierreTurnoRegistrado` en vez de `CierreDiaRegistrado`. Un único PDF por
// evento (a diferencia de día, acá no hay "consolidado" -- ver la nota de
// cabecera de ReporteTurnoDocumentoPorts.ts).
//
// `cierreTurnoId` viene directo del evento -- se usa para `obtenerTurnoPorId`
// (no `listarTurnos`/`cierreDiaId`: el turno recién cerrado todavía no tiene
// `cierre_dia_id` asignado, eso pasa cuando cierra el DÍA completo, ver el
// comentario del método en ReporteDiaQueryRepository.ts).
//
// Misma escritura idempotente que GenerarReporteDiaDocumento (key
// determinística, PUT sobrescribe) -- sin DynamoDB/Idempotency-Key propio.

import type { ReporteDiaQueryRepository } from '../ports/ReporteDiaQueryRepository';
import type { DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';
import type { ReporteTurnoRendererPort } from '../ports/ReporteTurnoDocumentoPorts';
import { construirKeyDocumentoTurno } from '../../domain/DocumentoReporteKey';

const CONTENT_TYPE = 'application/pdf';

export interface CierreTurnoRegistradoEventLike {
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
  readonly turno: 'TURNO1' | 'TURNO2' | 'TURNO3';
  readonly cierreTurnoId: string;
}

export class GenerarReporteTurnoDocumento {
  constructor(
    private readonly repo: ReporteDiaQueryRepository,
    private readonly renderer: ReporteTurnoRendererPort,
    private readonly storage: DocumentoStoragePort
  ) {}

  async ejecutar(evento: CierreTurnoRegistradoEventLike): Promise<void> {
    const turno = await this.repo.obtenerTurnoPorId(evento.cierreTurnoId);
    if (turno === null) {
      // No debería pasar -- el evento se publica justo después del INSERT
      // exitoso -- pero se deja el chequeo explícito en vez de asumir (mismo
      // criterio que GenerarReporteDiaDocumento con su cierre de día).
      console.error(
        `GenerarReporteTurnoDocumento: no se encontró cierre de turno ACTIVO con id ${evento.cierreTurnoId} (${evento.estacionCodigo}/${evento.fechaNegocio}/${evento.turno}) justo después de publicado el evento CierreTurnoRegistrado.`
      );
      return;
    }

    const buffer = await this.renderer.renderizarPdfTurno(evento.estacionCodigo, evento.fechaNegocio, turno);
    const key = construirKeyDocumentoTurno(evento.estacionCodigo, evento.fechaNegocio, evento.turno);
    await this.storage.subir({ buffer, key, contentType: CONTENT_TYPE });
  }
}
