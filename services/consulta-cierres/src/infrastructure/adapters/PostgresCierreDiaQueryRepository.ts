// infrastructure/adapters/PostgresCierreDiaQueryRepository.ts
//
// Mismo patrón que PostgresCierreTurnoQueryRepository.ts, pero contra
// `cierres_dia` — es el cierre consolidado del día (administrador), no de
// un turno individual (sección 3.3/3.4).

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';
import type { ParametrosPaginacion, ResultadoPaginado } from '../../domain/value-objects/Paginacion';
import type {
  CierreDiaQueryRepository,
  CierreDiaResumenDTO,
  FiltrosCierreDia,
} from '../../application/ports/CierreDiaQueryRepository';
import type { AuroraDataApiConfig } from './PostgresCierreTurnoQueryRepository';

export class PostgresCierreDiaQueryRepository implements CierreDiaQueryRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async listar(
    filtros: FiltrosCierreDia,
    paginacion: ParametrosPaginacion
  ): Promise<ResultadoPaginado<CierreDiaResumenDTO>> {
    const { whereSql, parameters } = construirWhere(filtros);
    const offset = (paginacion.page - 1) * paginacion.pageSize;

    const sqlDatos = `
      SELECT cd.id, e.codigo AS codigo_estacion, cd.isla, cd.fecha_negocio, cd.fecha, cd.total, cd.estado,
             u.usuario AS administrador_codigo, u.nombre AS administrador_nombre, cd.recibido_en
      FROM cierres_dia cd
      JOIN estaciones e ON e.id = cd.estacion_id
      LEFT JOIN usuarios u ON u.id = cd.administrador_id
      ${whereSql}
      ORDER BY cd.fecha DESC
      LIMIT :limit OFFSET :offset
    `;

    const sqlConteo = `
      SELECT COUNT(*) AS total
      FROM cierres_dia cd
      JOIN estaciones e ON e.id = cd.estacion_id
      LEFT JOIN usuarios u ON u.id = cd.administrador_id
      ${whereSql}
    `;

    const [filas, conteo] = await Promise.all([
      this.ejecutar(sqlDatos, [...parameters, param('limit', paginacion.pageSize), param('offset', offset)]),
      this.ejecutar(sqlConteo, parameters),
    ]);

    return {
      data: filas.map(mapearFila),
      pagination: { page: paginacion.page, pageSize: paginacion.pageSize, totalItems: leerConteo(conteo), totalPages: 1 },
    };
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

function construirWhere(filtros: FiltrosCierreDia): { whereSql: string; parameters: SqlParameter[] } {
  const condiciones: string[] = ['cd.estado = :estado'];
  const parameters: SqlParameter[] = [param('estado', filtros.estado)];

  if (filtros.estacionCodigo) {
    condiciones.push('e.codigo = :estacionCodigo');
    parameters.push(param('estacionCodigo', filtros.estacionCodigo));
  }
  if (filtros.fechaDesde) {
    condiciones.push('cd.fecha_negocio >= :fechaDesde');
    parameters.push(param('fechaDesde', filtros.fechaDesde));
  }
  if (filtros.fechaHasta) {
    condiciones.push('cd.fecha_negocio <= :fechaHasta');
    parameters.push(param('fechaHasta', filtros.fechaHasta));
  }

  return { whereSql: `WHERE ${condiciones.join(' AND ')}`, parameters };
}

function param(name: string, value: string | number): SqlParameter {
  return typeof value === 'number' ? { name, value: { longValue: value } } : { name, value: { stringValue: value } };
}

function leerConteo(filas: Record<string, unknown>[]): number {
  const total = filas[0]?.total;
  return typeof total === 'number' ? total : Number(total ?? 0);
}

function mapearFila(fila: Record<string, unknown>): CierreDiaResumenDTO {
  return {
    id: String(fila.id),
    codigoEstacion: String(fila.codigo_estacion),
    isla: (fila.isla as string | null) ?? null,
    fechaNegocio: String(fila.fecha_negocio),
    fecha: String(fila.fecha),
    total: Number(fila.total),
    estado: fila.estado as CierreDiaResumenDTO['estado'],
    administrador: { codigo: String(fila.administrador_codigo ?? ''), nombre: String(fila.administrador_nombre ?? '') },
    recibidoEn: String(fila.recibido_en),
  };
}
