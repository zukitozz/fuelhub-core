// application/use-cases/GenerarReporteComprasSemanalDocumento.ts
//
// Orquesta el cron semanal de compras (v1.86) -- disparado por un
// `events.Rule` con `schedule` (lunes por la mañana), no por un evento de
// negocio: a diferencia de día/turno, acá NO llega ningún "cierre" que
// dispare esto, así que este caso de uso es quien decide el universo
// completo (todas las estaciones activas), no un handler reaccionando a
// una estación puntual.
//
// Aislamiento por estación (mismo criterio que `ingest-compra-correo`): una
// estación que falla (Postgres, S3, EventBridge) no debe tumbar el reporte
// de las demás -- se loguea y se sigue.
//
// Siempre genera y publica, aunque `obtenerVolumenesPorProducto` devuelva
// `[]` (semana sin compras de combustible) -- decisión de Jorge, ver nota
// de cabecera del puerto de query.

import type { ReporteComprasSemanalQueryRepository } from '../ports/ReporteComprasSemanalQueryRepository';
import type { ReporteComprasSemanalRendererPort } from '../ports/ReporteComprasSemanalDocumentoPorts';
import type { DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';
import type { EventPublisherPort } from '../ports/EventPublisherPort';
import { construirKeyDocumentoComprasSemanal } from '../../domain/DocumentoReporteKey';
import { sumarDias } from '../../domain/value-objects/RangoFechas';

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PROYECTO_CODIGO = 'FUELHUBCLOUD'; // mismo valor que RegistrarCierreDia.ts/RegistrarCierreTurno.ts
const TIPO = 'reporte semanal de compras';

export class GenerarReporteComprasSemanalDocumento {
  constructor(
    private readonly repo: ReporteComprasSemanalQueryRepository,
    private readonly renderer: ReporteComprasSemanalRendererPort,
    private readonly storage: DocumentoStoragePort,
    private readonly eventos: EventPublisherPort
  ) {}

  /** `fechaInicio` es el lunes de la semana a reportar (la anterior a hoy). */
  async ejecutar(fechaInicio: string): Promise<void> {
    const fechaFin = sumarDias(fechaInicio, 6);
    const estaciones = await this.repo.listarEstacionesActivas();

    for (const estacion of estaciones) {
      try {
        await this.generarYNotificarUnaEstacion(estacion.id, estacion.codigo, fechaInicio, fechaFin);
      } catch (err) {
        console.error(
          `GenerarReporteComprasSemanalDocumento: falló la estación ${estacion.codigo} (${fechaInicio}/${fechaFin}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  private async generarYNotificarUnaEstacion(estacionId: string, estacionCodigo: string, fechaInicio: string, fechaFin: string): Promise<void> {
    const items = await this.repo.obtenerVolumenesPorProducto(estacionCodigo, fechaInicio, fechaFin);
    const buffer = await this.renderer.renderizarExcel({ estacionCodigo, fechaInicio, fechaFin, items });
    const key = construirKeyDocumentoComprasSemanal(estacionCodigo, fechaInicio, fechaFin);
    await this.storage.subir({ buffer, key, contentType: CONTENT_TYPE });

    try {
      await this.eventos.publicarReporteComprasSemanalRegistrado({
        proyectoCodigo: PROYECTO_CODIGO,
        estacionId,
        estacionCodigo,
        fechaInicio,
        fechaFin,
        tipo: TIPO,
        reporteSemanalId: `${estacionId}-${fechaInicio}`,
      });
    } catch (errorDePublicacion) {
      // Best effort a propósito, mismo criterio que RegistrarCierreDia.ts/
      // RegistrarCierreTurno.ts: el Excel ya quedó subido a S3 (la parte
      // que de verdad importa que no se pierda); una falla de EventBridge
      // no debe tumbar el resto de las estaciones de esta misma corrida.
      console.error(`GenerarReporteComprasSemanalDocumento: no se pudo publicar el evento para ${estacionCodigo}:`, errorDePublicacion);
    }
  }
}
