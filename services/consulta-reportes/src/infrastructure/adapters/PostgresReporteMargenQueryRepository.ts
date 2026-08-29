// infrastructure/adapters/PostgresReporteMargenQueryRepository.ts
//
// Traduce el SQL de ejemplo de la sección 3.8.2.b a RDS Data API. Único
// cambio real frente al ejemplo del spec: los `BETWEEN` fijos se vuelven
// condicionales (fechaDesde/fechaHasta son opcionales, sección 11.2) y se
// agrega el filtro por estación puntual o por lista (sección 5.4).
//
// Nota heredada del ejemplo original (no es una decisión nueva de este
// adaptador): las ventas de productos NO mapeados al catálogo cruzado
// (`producto_id IS NULL`, sección 3.8.1.1 — balón de gas, mercadito) sí
// suman a `ingresosTotales` pero no tienen forma de cruzar con
// `costo_promedio` (que sale de `compras.producto_id`, siempre NOT NULL)
// — su costo simplemente no se estima, igual que en la consulta de 3.8.2.b.
//
// Solo lectura, sin transacción explícita (mismo criterio que
// consulta-cierres: no hay escritura que proteger).

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';
import type { FiltrosReporteMargen, ReporteMargenItemDTO, ReporteMargenQueryRepository } from '../../application/ports/ReporteMargenQueryRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresReporteMargenQueryRepository implements ReporteMargenQueryRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async obtener(filtros: FiltrosReporteMargen): Promise<ReporteMargenItemDTO[]> {
    const parametros: SqlParameter[] = [];
    const condicionesCompras: string[] = [];
    const condicionesVentas: string[] = ["ct.estado = 'ACTIVO'"];
    const condicionesFinal: string[] = [];

    if (filtros.fechaDesde) {
      condicionesCompras.push('c.fecha >= :fechaDesde');
      condicionesVentas.push('ct.fecha_negocio >= :fechaDesde');
      parametros.push({ name: 'fechaDesde', value: { stringValue: filtros.fechaDesde } });
    }
    if (filtros.fechaHasta) {
      condicionesCompras.push('c.fecha <= :fechaHasta');
      condicionesVentas.push('ct.fecha_negocio <= :fechaHasta');
      parametros.push({ name: 'fechaHasta', value: { stringValue: filtros.fechaHasta } });
    }
    if (filtros.estacionCodigo) {
      condicionesFinal.push('e.codigo = :estacionCodigo');
      parametros.push({ name: 'estacionCodigo', value: { stringValue: filtros.estacionCodigo } });
    } else if (filtros.estacionesCodigos && filtros.estacionesCodigos.length > 0) {
      condicionesFinal.push('e.codigo = ANY(CAST(:estacionesCodigos AS text[]))');
      parametros.push({ name: 'estacionesCodigos', value: { arrayValue: { stringValues: [...filtros.estacionesCodigos] } } });
    }

    const whereCompras = condicionesCompras.length > 0 ? `WHERE ${condicionesCompras.join(' AND ')}` : '';
    const whereVentas = `WHERE ${condicionesVentas.join(' AND ')}`;
    const whereFinal = condicionesFinal.length > 0 ? `WHERE ${condicionesFinal.join(' AND ')}` : '';

    const sql = `
      WITH costo_promedio AS (
        SELECT c.estacion_id, c.producto_id,
               SUM(c.costo_total) / NULLIF(SUM(c.cantidad), 0) AS costo_unitario_promedio
        FROM compras c
        ${whereCompras}
        GROUP BY c.estacion_id, c.producto_id
      ),
      ventas AS (
        SELECT ct.estacion_id, ctd.producto_id,
               SUM(ctd.despacho_cantidad) AS cantidad_vendida,
               SUM(ctd.despacho_soles)    AS ingresos
        FROM cierres_turno_detalle ctd
        JOIN cierres_turno ct ON ct.id = ctd.cierre_turno_id
        ${whereVentas}
        GROUP BY ct.estacion_id, ctd.producto_id
      )
      SELECT e.codigo AS codigo_estacion,
             SUM(v.ingresos)                                                        AS ingresos_totales,
             SUM(v.cantidad_vendida * cp.costo_unitario_promedio)                    AS costo_ventas_estimado,
             SUM(v.ingresos) - SUM(v.cantidad_vendida * cp.costo_unitario_promedio)  AS margen_estimado
      FROM ventas v
      JOIN estaciones e            ON e.id = v.estacion_id
      LEFT JOIN costo_promedio cp  ON cp.estacion_id = v.estacion_id AND cp.producto_id = v.producto_id
      ${whereFinal}
      GROUP BY e.codigo
      ORDER BY margen_estimado DESC
    `;

    const filas = await this.ejecutar(sql, parametros);
    return filas.map(mapearFila);
  }

  private async ejecutar(sql: string, parameters: SqlParameter[]): Promise<Record<string, unknown>[]> {
    const resultado = await this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.config.resourceArn,
        secretArn: this.config.secretArn,
        database: this.config.database,
        sql,
        parameters,
        formatRecordsAs: 'JSON',
      })
    );
    return resultado.formattedRecords ? (JSON.parse(resultado.formattedRecords) as Record<string, unknown>[]) : [];
  }
}

function mapearFila(fila: Record<string, unknown>): ReporteMargenItemDTO {
  const ingresosTotales = Number(fila.ingresos_totales);
  // `costo_ventas_estimado` puede venir NULL si ninguna venta del período
  // tuvo cruce con `costo_promedio` (p. ej. estación sin compras registradas
  // ese rango, o toda la venta es de productos no mapeados — sección
  // 3.8.1.1) — se normaliza a 0 en vez de propagar `NaN`/`null`, y
  // `margenEstimado` se recalcula acá (no se usa la columna SQL directa) para
  // que ambos campos queden siempre consistentes entre sí.
  const costoVentasEstimado = fila.costo_ventas_estimado === null || fila.costo_ventas_estimado === undefined
    ? 0
    : Number(fila.costo_ventas_estimado);
  return {
    estacion: String(fila.codigo_estacion),
    ingresosTotales,
    costoVentasEstimado,
    margenEstimado: ingresosTotales - costoVentasEstimado,
  };
}
