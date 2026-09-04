// infrastructure/adapters/PostgresReporteAbastecimientoQueryRepository.ts
//
// Traduce el SQL de ejemplo de la sección 3.8.2.c a RDS Data API.
//
// Dos decisiones propias frente al ejemplo del spec, flagueadas acá y en el
// changelog de esta versión (ninguna cambia el resultado para el caso normal,
// solo lo acotan/completan donde el spec no era explícito):
//
//   1. `t.activo = true` — se agrega un filtro que el ejemplo original no
//      tenía, para no reportar autonomía/riesgo de tanques dados de baja
//      (sección 3.8.3, `PUT /tanques/{id}` con `activo: false`). Mismo
//      criterio de inferencia ya usado en `ingest-compra` (validación de
//      `tanqueId` vs. estación) — a confirmar contigo.
//   2. `en_riesgo` se calcula en SQL (no estaba en el ejemplo de 3.8.2.c,
//      que predata el campo `enRiesgo` del contrato OpenAPI) replicando
//      exactamente la regla en prosa de esa misma sección: "cuando
//      frecuencia_real_dias es mayor que dias_de_autonomia_estimados, esa
//      estación está en riesgo". Si falta cualquiera de los dos valores
//      (sin ventas o sin >=2 compras registradas), `enRiesgo` es `false` —
//      no hay señal suficiente para marcar riesgo.
//
// Orden de salida: `enRiesgo` primero (`true` antes que `false`, tal como
// pide la `description` de `GET /reportes/abastecimiento` en el contrato),
// y dentro de cada grupo, menor autonomía primero (el criterio de orden que
// sí traía el ejemplo original de 3.8.2.c).
//
// Solo lectura, sin transacción explícita.

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';
import { conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
import type {
  FiltrosReporteAbastecimiento,
  ReporteAbastecimientoItemDTO,
  ReporteAbastecimientoQueryRepository,
} from '../../application/ports/ReporteAbastecimientoQueryRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresReporteAbastecimientoQueryRepository implements ReporteAbastecimientoQueryRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async obtener(filtros: FiltrosReporteAbastecimiento): Promise<ReporteAbastecimientoItemDTO[]> {
    const parametros: SqlParameter[] = [];
    const condicionesFinal: string[] = ['t.activo = true'];

    if (filtros.estacionCodigo) {
      condicionesFinal.push('e.codigo = :estacionCodigo');
      parametros.push({ name: 'estacionCodigo', value: { stringValue: filtros.estacionCodigo } });
    } else if (filtros.estacionesCodigos && filtros.estacionesCodigos.length > 0) {
      // IN (...) con un placeholder por código -- v1.51, mismo motivo que
      // PostgresCierreTurnoIngestaRepository.validarProductos: RDS Data API
      // rechaza `arrayValue` en runtime ("Array parameters are not
      // supported"), sin importar el tipo de los elementos.
      const codigos = [...filtros.estacionesCodigos];
      const placeholders = codigos.map((_, i) => `:estacionCodigo${i}`).join(', ');
      condicionesFinal.push(`e.codigo IN (${placeholders})`);
      codigos.forEach((codigo, i) => parametros.push({ name: `estacionCodigo${i}`, value: { stringValue: codigo } }));
    }

    const sql = `
      WITH venta_diaria AS (
        SELECT ct.estacion_id, ctd.producto_id,
               SUM(ctd.despacho_cantidad) / GREATEST(COUNT(DISTINCT ct.fecha_negocio), 1) AS venta_promedio_diaria
        FROM cierres_turno_detalle ctd
        JOIN cierres_turno ct ON ct.id = ctd.cierre_turno_id
        WHERE ct.fecha_negocio >= CURRENT_DATE - INTERVAL '30 days'
          AND ct.estado = 'ACTIVO'
        GROUP BY ct.estacion_id, ctd.producto_id
      ),
      frecuencia_real AS (
        -- EXTRACT(EPOCH FROM ...) / 86400 -- v1.51, descubierto en el primer
        -- test:integration real: "fecha - fecha_anterior" da un INTERVAL de
        -- Postgres, y más abajo se compara contra una expresión NUMERIC
        -- (capacidad / venta_promedio_diaria) sin cast posible entre esos
        -- dos tipos ("operator does not exist: interval > numeric"). Se
        -- convierte a días (numeric) acá, en el origen, en vez de castear en
        -- cada punto donde se usa -- también corrige de paso que
        -- formatRecordsAs 'JSON' no serializa un INTERVAL como algo que
        -- Number(...) (mapearFila/numeroONulo, abajo) pueda leer.
        SELECT estacion_id, producto_id, AVG(EXTRACT(EPOCH FROM (fecha - fecha_anterior)) / 86400) AS dias_entre_compras
        FROM (
          SELECT estacion_id, producto_id, fecha,
                 LAG(fecha) OVER (PARTITION BY estacion_id, producto_id ORDER BY fecha) AS fecha_anterior
          FROM compras
        ) sub
        WHERE fecha_anterior IS NOT NULL
        GROUP BY estacion_id, producto_id
      )
      SELECT e.codigo AS codigo_estacion, t.nombre AS tanque, pm.nombre AS producto,
             t.capacidad,
             vd.venta_promedio_diaria,
             ROUND(t.capacidad / NULLIF(vd.venta_promedio_diaria, 0), 1) AS dias_de_autonomia_estimados,
             fr.dias_entre_compras AS frecuencia_real_dias,
             CASE
               WHEN fr.dias_entre_compras IS NOT NULL
                AND (t.capacidad / NULLIF(vd.venta_promedio_diaria, 0)) IS NOT NULL
                AND fr.dias_entre_compras > (t.capacidad / NULLIF(vd.venta_promedio_diaria, 0))
               THEN true
               ELSE false
             END AS en_riesgo
      FROM tanques t
      JOIN estaciones e         ON e.id = t.estacion_id
      JOIN productos_maestro pm ON pm.id = t.producto_id
      LEFT JOIN venta_diaria vd    ON vd.estacion_id = t.estacion_id AND vd.producto_id = t.producto_id
      LEFT JOIN frecuencia_real fr ON fr.estacion_id = t.estacion_id AND fr.producto_id = t.producto_id
      WHERE ${condicionesFinal.join(' AND ')}
      ORDER BY en_riesgo DESC, dias_de_autonomia_estimados ASC NULLS LAST
    `;

    const filas = await this.ejecutar(sql, parametros);
    return filas.map(mapearFila);
  }

  private async ejecutar(sql: string, parameters: SqlParameter[]): Promise<Record<string, unknown>[]> {
    const resultado = await conReintentoSiDbEstaResumiendo(() => this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.config.resourceArn,
        secretArn: this.config.secretArn,
        database: this.config.database,
        sql,
        parameters,
        formatRecordsAs: 'JSON',
      })
    ));
    return resultado.formattedRecords ? (JSON.parse(resultado.formattedRecords) as Record<string, unknown>[]) : [];
  }
}

function mapearFila(fila: Record<string, unknown>): ReporteAbastecimientoItemDTO {
  return {
    estacion: String(fila.codigo_estacion),
    tanque: String(fila.tanque),
    producto: String(fila.producto),
    capacidad: Number(fila.capacidad),
    ventaPromedioDiaria: numeroONulo(fila.venta_promedio_diaria),
    diasDeAutonomiaEstimados: numeroONulo(fila.dias_de_autonomia_estimados),
    frecuenciaRealDias: numeroONulo(fila.frecuencia_real_dias),
    enRiesgo: Boolean(fila.en_riesgo),
  };
}

function numeroONulo(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : Number(valor);
}
