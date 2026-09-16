// application/use-cases/GenerarReporteDiaDocumento.ts
//
// v1.78 -- caso de uso nuevo, disparado por el evento `CierreDiaRegistrado`
// (EventBridge, publicado best-effort por `ingest-cierre-dia` -- sección
// 4.1) en vez de por un request HTTP. Reemplaza la generación al vuelo que
// hacía `ObtenerReporteDiaDocumento` hasta v1.77: absorbe de ahí toda la
// lógica de armar los datos del PDF (repo + renderer), pero ya no resuelve
// nada de autorización/Cognito (no hay `AuthContext` -- esto no lo dispara
// un cliente HTTP) ni decide QUÉ estación reportar (eso ya viene resuelto
// en el evento).
//
// Dos PDFs por cada cierre de día que llega:
//   1. El de la propia estación (`{ESTACION}-{fecha}.pdf`).
//   2. El CONSOLIDADO del día (`CONSOLIDADO-{fecha}.pdf`), que se
//      REGENERA por completo -- todas las estaciones activas que ya
//      tengan cierre ese día, no solo la que acaba de llegar -- decisión
//      confirmada con Jorge: "cada vez que llega un cierre" en vez de
//      esperar a que cierren todas. Mismo criterio de "omitir estaciones
//      sin cierre ese día" que ya usaba el consolidado dinámico anterior
//      (v1.62).
//
// Ambas escrituras son naturalmente idempotentes (misma key determinística,
// PUT sobrescribe) -- una entrega duplicada del evento (EventBridge es
// at-least-once) o un reintento no corrompe nada, simplemente vuelve a
// escribir el mismo PDF. Por eso este caso de uso no necesita su propio
// `Idempotency-Key`/DynamoDB (a diferencia de `ingest-cierre-dia`/
// `ingest-cierre-turno`, que si lo necesitan porque ahí el efecto -- un
// INSERT -- no es idempotente por sí solo).
//
// Fallos: si Postgres/pdfkit/S3 fallan acá, se loguea y se relanza (para
// que el Lambda quede como "Failed" en CloudWatch/Lambda Insights) -- no
// hay revert posible ni tiene sentido (el cierre de día YA está grabado,
// es la fuente de verdad; el PDF es una proyección derivable en cualquier
// momento re-disparando este mismo caso de uso a mano si hiciera falta).

import type { ReporteDiaQueryRepository } from '../ports/ReporteDiaQueryRepository';
import type { DocumentoStoragePort, ReporteDiaEstacionDocumentoDTO, ReporteDiaRendererPort } from '../ports/ReporteDiaDocumentoPorts';
import { construirKeyDocumentoConsolidado, construirKeyDocumentoEstacion } from '../../domain/DocumentoReporteKey';

const CONTENT_TYPE = 'application/pdf';

export interface CierreDiaRegistradoEventLike {
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
}

export class GenerarReporteDiaDocumento {
  constructor(
    private readonly repo: ReporteDiaQueryRepository,
    private readonly renderer: ReporteDiaRendererPort,
    private readonly storage: DocumentoStoragePort
  ) {}

  async ejecutar(evento: CierreDiaRegistradoEventLike): Promise<void> {
    await this.generarIndividual(evento.estacionCodigo, evento.fechaNegocio);
    await this.generarConsolidado(evento.fechaNegocio);
  }

  private async generarIndividual(estacionCodigo: string, fechaNegocio: string): Promise<void> {
    const estacion = await this.obtenerEstacion(estacionCodigo, fechaNegocio);
    if (estacion === null) {
      // No debería pasar -- el evento se publica justo después del INSERT
      // exitoso -- pero se deja el chequeo explícito en vez de asumir. Si se
      // dispara de verdad, es una condición de carrera real (lectura
      // consistente eventual de RDS Data API, o un ANULADO concurrente) que
      // vale la pena ver en los logs en vez de tragarse en silencio.
      console.error(
        `GenerarReporteDiaDocumento: no se encontró cierre de día ACTIVO para ${estacionCodigo}/${fechaNegocio} justo después de publicado el evento CierreDiaRegistrado.`
      );
      return;
    }
    const buffer = await this.renderer.renderizarPdf({ modo: 'individual', estacion });
    await this.storage.subir({ buffer, key: construirKeyDocumentoEstacion(estacionCodigo, fechaNegocio), contentType: CONTENT_TYPE });
  }

  private async generarConsolidado(fechaNegocio: string): Promise<void> {
    const codigos = await this.repo.listarCodigosEstacionesActivas();
    const estaciones = await this.obtenerEstaciones(codigos, fechaNegocio);
    if (estaciones.length === 0) {
      // Ninguna estación activa tiene cierre ese día todavía (no debería
      // ocurrir -- se está generando justo porque UNA lo acaba de tener --
      // salvo que esa estación se haya desactivado entre el INSERT y acá).
      return;
    }
    const buffer = await this.renderer.renderizarPdf({ modo: 'consolidado', fechaNegocio, estaciones });
    await this.storage.subir({ buffer, key: construirKeyDocumentoConsolidado(fechaNegocio), contentType: CONTENT_TYPE });
  }

  private async obtenerEstacion(estacionCodigo: string, fechaNegocio: string): Promise<ReporteDiaEstacionDocumentoDTO | null> {
    const reporte = await this.repo.obtener({ estacionCodigo, fechaNegocio });
    if (reporte === null) return null;
    const turnos = await this.repo.listarTurnos(reporte.cierreDiaId);
    return { reporte, turnos };
  }

  private async obtenerEstaciones(codigos: readonly string[], fechaNegocio: string): Promise<ReporteDiaEstacionDocumentoDTO[]> {
    const reportes = await Promise.all(codigos.map((estacionCodigo) => this.obtenerEstacion(estacionCodigo, fechaNegocio)));
    return reportes.filter((r): r is ReporteDiaEstacionDocumentoDTO => r !== null);
  }
}
