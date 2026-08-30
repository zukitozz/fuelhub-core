// infrastructure/adapters/PostgresCierreTurnoQueryRepository.ts
//
// Implementa el puerto contra Aurora Serverless v2 vía RDS Data API
// (sección 6.1) — es la única capa que conoce el AWS SDK y el esquema real
// en snake_case español (sección 3.3); el resto del microservicio nunca ve
// una columna de Postgres directamente.
//
// Simplificado a propósito para este scaffolding: arma SQL parametrizado a
// mano. En una implementación completa conviene un query builder liviano
// (p. ej. Kysely) para evitar concatenar condicionalmente `WHERE` a mano —
// queda como decisión de implementación, no cambia el contrato del puerto.

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';
import type { ParametrosPaginacion, ResultadoPaginado } from '../../domain/value-objects/Paginacion';
import type {
  CierreTurnoQueryRepository,
  CierreTurnoResumenDTO,
  FiltrosCierreTurno,
} from '../../application/ports/CierreTurnoQueryRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string; // ARN del cluster Aurora
  readonly secretArn: string; // ARN del secret con credenciales de la Data API
  readonly database: string;
}

export class PostgresCierreTurnoQueryRepository implements CierreTurnoQueryRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async listar(
    filtros: FiltrosCierreTurno,
    paginacion: ParametrosPaginacion
  ): Promise<ResultadoPaginado<CierreTurnoResumenDTO>> {
    const { whereSql, parameters } = construirWhere(filtros);
    const offset = (paginacion.page - 1) * paginacion.pageSize;

    const sqlDatos = `
      SELECT ct.id, e.codigo AS codigo_estacion, ct.isla, ct.turno, ct.fecha_negocio,
             ct.fecha_inicio, ct.fecha, ct.total, ct.estado,
             u.usuario AS empleado_codigo, u.nombre AS empleado_nombre, ct.recibido_en
      FROM cierres_turno ct
      JOIN estaciones e ON e.id = ct.estacion_id
      LEFT JOIN usuarios u ON u.id = ct.usuario_id
      ${whereSql}
      ORDER BY ct.fecha DESC
      LIMIT :limit OFFSET :offset
    `;

    const sqlConteo = `
      SELECT COUNT(*) AS total
      FROM cierres_turno ct
      JOIN estaciones e ON e.id = ct.estacion_id
      LEFT JOIN usuarios u ON u.id = ct.usuario_id
      ${whereSql}
    `;

    const [filas, conteo] = await Promise.all([
      this.ejecutar(sqlDatos, [...parameters, param('limit', paginacion.pageSize), param('offset', offset)]),
      this.ejecutar(sqlConteo, parameters),
    ]);

    return {
      data: filas.map(mapearFila),
      pagination: { page: paginacion.page, pageSize: paginacion.pageSize, totalItems: leerConteo(conteo), totalPages: 1 },
      // totalPages real lo termina de calcular el caso de uso (construirPaginacion) con este totalItems.
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

function construirWhere(filtros: FiltrosCierreTurno): { whereSql: string; parameters: SqlParameter[] } {
  // CAST(:estado AS estado_cierre) -- v1.51, mismo bug que se encontró y
  // corrigió en el repositorio hermano PostgresCierreDiaQueryRepository (no
  // lo disparó ningún test:integration existente, pero es idéntico: RDS
  // Data API manda el parámetro sin tipo explícito y Postgres no tiene cast
  // implícito de texto al ENUM estado_cierre para "=").
  const condiciones: string[] = ['ct.estado = CAST(:estado AS estado_cierre)'];
  const parameters: SqlParameter[] = [param('estado', filtros.estado)];

  if (filtros.estacionCodigo) {
    condiciones.push('e.codigo = :estacionCodigo');
    parameters.push(param('estacionCodigo', filtros.estacionCodigo));
  }
  if (filtros.fechaDesde) {
    condiciones.push('ct.fecha_negocio >= :fechaDesde');
    parameters.push(param('fechaDesde', filtros.fechaDesde));
  }
  if (filtros.fechaHasta) {
    condiciones.push('ct.fecha_negocio <= :fechaHasta');
    parameters.push(param('fechaHasta', filtros.fechaHasta));
  }
  if (filtros.turno) {
    condiciones.push('ct.turno = :turno');
    parameters.push(param('turno', filtros.turno));
  }
  if (filtros.usuarioCodigo) {
    condiciones.push('u.usuario = :usuarioCodigo');
    parameters.push(param('usuarioCodigo', filtros.usuarioCodigo));
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

function mapearFila(fila: Record<string, unknown>): CierreTurnoResumenDTO {
  return {
    id: String(fila.id),
    codigoEstacion: String(fila.codigo_estacion),
    isla: (fila.isla as string | null) ?? null,
    turno: fila.turno as CierreTurnoResumenDTO['turno'],
    fechaNegocio: String(fila.fecha_negocio),
    fechaInicio: String(fila.fecha_inicio),
    fecha: String(fila.fecha),
    total: Number(fila.total),
    estado: fila.estado as CierreTurnoResumenDTO['estado'],
    empleado: { codigo: String(fila.empleado_codigo ?? ''), nombre: String(fila.empleado_nombre ?? '') },
    recibidoEn: String(fila.recibido_en),
  };
}
