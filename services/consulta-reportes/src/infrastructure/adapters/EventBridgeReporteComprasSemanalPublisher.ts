// infrastructure/adapters/EventBridgeReporteComprasSemanalPublisher.ts
//
// Único lugar que conoce el SDK de EventBridge para este evento (v1.86) --
// calco de `EventBridgeCierreTurnoPublisher.ts` (ingest-cierre-turno), con
// UN agregado propio (v1.87): reintento con backoff antes de rendirse, vía
// `conReintentoConBackoff` (packages/shared-kernel/src/retry-con-backoff.ts
// -- lógica genérica, probada ahí mismo como función pura; este archivo es
// un adaptador de infraestructura y el `testMatch` de jest.config.mjs NO
// recoge tests bajo `infrastructure/adapters/**`, así que cualquier lógica
// que valga la pena probar tiene que vivir en una función pura importable
// desde `domain`/`application`/`shared-kernel`, no acá).
//
// Por qué acá sí y en CierreDia/CierreTurno no: en esos dos, el evento se
// publica justo después de un INSERT que el cliente HTTP está esperando --
// reintentar ahí adentro alargaría la respuesta de un POST real. Acá el
// publish ocurre al final de un cron SIN cliente esperando nada (ver
// GenerarReporteComprasSemanalDocumento.ts) -- hay margen de sobra para
// unos segundos de reintento antes de resignarse y dejar el Excel sin
// notificación esa semana (pedido de Jorge: "agrega la capacidad de
// reintento").
//
// 3 intentos en total (1 + 2 reintentos), backoff corto (500ms/1.5s) --
// mucho más corto que el de Aurora resumiendo (`rds-retry.ts`, 14s): acá no
// se espera un "despertar" de varios segundos, solo blips de red o
// throttling puntual de PutEvents, que normalmente se resuelven rápido. Si
// los 3 intentos fallan, se propaga el error tal cual -- el caso de uso que
// llama a esto ya lo trata como best effort (log y seguir con la próxima
// estación), ver GenerarReporteComprasSemanalDocumento.ts.

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { conReintentoConBackoff } from '@fuelhub/shared-kernel';
import type { EventPublisherPort, ReporteComprasSemanalRegistradoEvent } from '../../application/ports/EventPublisherPort';

const SOURCE = 'FuelHubCloud';
const DETAIL_TYPE = 'ReporteComprasSemanalRegistrado';

export class EventBridgeReporteComprasSemanalPublisher implements EventPublisherPort {
  constructor(private readonly client: EventBridgeClient, private readonly busName: string) {}

  async publicarReporteComprasSemanalRegistrado(evento: ReporteComprasSemanalRegistradoEvent): Promise<void> {
    await conReintentoConBackoff(() => this.publicarUnaVez(evento), {
      intentosMax: 3,
      esperasMs: [500, 1500],
      antesDeReintentar: (err, intento) =>
        console.warn(
          `EventBridgeReporteComprasSemanalPublisher: reintento ${intento}/2 tras fallo: ${err instanceof Error ? err.message : String(err)}`
        ),
    });
  }

  private async publicarUnaVez(evento: ReporteComprasSemanalRegistradoEvent): Promise<void> {
    const resultado = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: SOURCE,
            DetailType: DETAIL_TYPE,
            Detail: JSON.stringify(evento),
          },
        ],
      })
    );

    if (resultado.FailedEntryCount && resultado.FailedEntryCount > 0) {
      const detalle = resultado.Entries?.[0];
      throw new Error(`EventBridge rechazó el evento ReporteComprasSemanalRegistrado: ${detalle?.ErrorCode} — ${detalle?.ErrorMessage}`);
    }
  }
}
