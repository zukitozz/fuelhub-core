// infrastructure/adapters/PostgresReporteComprasSemanalQueryRepository.ts
//
// Implementa el reporte semanal de compras (v1.86) -- lee `compras`
// directamente (no `cierres_turno_detalle`, que es venta/POS). Solo cuenta
// `estado = 'ACTIVO'` y `categoria = 'COMBUSTIBLE'` -- ver la nota de
// cabecera del puerto (`ReporteComprasSemanalQueryRepository.ts`) para el
// porqué.
//
// `c.fecha` es TIMESTAMPTZ (hora exacta de la compra, no DATE) -- mismo
// patrón de rango ya establecido en `PostgresCompraIngestaRepository.ts`
// (`listar`, filtro `fechaDesde`/`fechaHasta`): `>= CAST(fechaInicio AS
// date)` y `< CAST(fechaFin AS date) + INTERVAL '1 day'`, para que la
// comparación contra un TIMESTAMPTZ incluya TODO el día de `fechaFin`, no
// solo la medianoche.
//
// `producto_nombre` no necesita JOIN a `productos_maestro`: `compras` ya lo
// guarda denormalizado en la propia fila (lo pone
// `ProcesarFacturaProveedorCorreo.ts` al insertar, matcheado o no contra el
// catálogo) -- mismo criterio que ya usa `PostgresCompraIngestaRepository.ts`
// para listar/leer compras.

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';
import { conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
import type {
  EstacionActivaDTO,
  ReporteComprasSemanalItemDTO,
  ReporteComprasSemanalQueryRepository,
} from '../../application/ports/ReporteComprasSemanalQueryRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresReporteComprasSemanalQueryRepository implements ReporteComprasSemanalQueryRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async obtenerVolumenesPorProducto(
    estacionCodigo: string,
    fechaInicio: string,
    fechaFin: string
  ): Promise<readonly ReporteComprasSemanalItemDTO[]> {
    const filas = await this.ejecutar(
      `SELECT c.producto_nombre AS producto, SUM(COALESCE(c.cantidad, 0)) AS volumen
       FROM compras c
       JOIN estaciones e ON e.id = c.estacion_id
       WHERE e.codigo = :estacionCodigo
         AND c.estado = CAST(:estado AS estado_compra)
         AND c.categoria = CAST(:categoria AS categoria_producto)
         AND c.fecha >= CAST(:fechaInicio AS date)
         AND c.fecha < CAST(:fechaFin AS date) + INTERVAL '1 day'
       GROUP BY c.producto_nombre
       ORDER BY c.producto_nombre`,
      [
        { name: 'estacionCodigo', value: { stringValue: estacionCodigo } },
        { name: 'estado', value: { stringValue: 'ACTIVO' } },
        { name: 'categoria', value: { stringValue: 'COMBUSTIBLE' } },
        { name: 'fechaInicio', value: { stringValue: fechaInicio } },
        { name: 'fechaFin', value: { stringValue: fechaFin } },
      ]
    );
    return filas.map((fila) => ({ producto: String(fila.producto), volumen: Number(fila.volumen) }));
  }

  async listarEstacionesActivas(): Promise<readonly EstacionActivaDTO[]> {
    const filas = await this.ejecutar('SELECT id, codigo FROM estaciones WHERE activo = TRUE ORDER BY codigo', []);
    return filas.map((fila) => ({ id: String(fila.id), codigo: String(fila.codigo) }));
  }

  private async ejecutar(sql: string, parameters: SqlParameter[]): Promise<Record<string, unknown>[]> {
    const resultado = await conReintentoSiDbEstaResumiendo(() =>
      this.client.send(
        new ExecuteStatementCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          database: this.config.database,
          sql,
          parameters,
          formatRecordsAs: 'JSON',
        })
      )
    );
    return resultado.formattedRecords ? (JSON.parse(resultado.formattedRecords) as Record<string, unknown>[]) : [];
  }
}
