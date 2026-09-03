// infrastructure/adapters/PostgresReporteDiaQueryRepository.ts
//
// Implementa `GET /v1/reportes/dia` (v1.58). Dos decisiones propias que no
// son continuación mecánica de un ejemplo de la sección 3.8.2 (a diferencia
// de margen/abastecimiento, este reporte no tenía un SQL de ejemplo previo):
//
//   1. Se agrupan los `cierres_turno` del día por `estacion_id`+`fecha_negocio`,
//      NO por `cierre_dia_id`. La columna `cierres_turno.cierre_dia_id`
//      existe en el esquema (3.3) pero HOY NINGÚN caso de uso la escribe —
//      `RegistrarCierreDia` nunca hace el UPDATE que asociaría los turnos
//      del día a su fila de `cierres_dia` — así que confiar en ella dejaría
//      este reporte siempre vacío. Es el mismo criterio de fecha que ya usan
//      las 3 consultas de ejemplo de 3.8.2 (a/b/c). Se deja anotado como
//      hallazgo a confirmar con Jorge (changelog de esta versión) — arreglar
//      el UPDATE en sí queda fuera de alcance de este endpoint.
//
//   2. `ingresos`/`cantidadVendida` por producto usan
//      `COALESCE(despacho_*, total_*, 0)`, no `despacho_*` a secas (que sí
//      usan margen/abastecimiento). Motivo: `despacho_cantidad`/`despacho_soles`
//      son OPCIONALES en el contrato de `detalle[i]` (pensados para separar
//      venta real de calibración/"Serafín" en productos que salen de un
//      surtidor, ver changelog v1.55) — una línea sin concepto de
//      calibración (balón de gas, mercadito) puede llegar sin esos dos
//      campos. Sin este fallback, cualquier venta no-combustible que no
//      mande `despacho*` explícito contaría como 0 en `totalNoCombustible`,
//      justo el número que este endpoint existe para reportarle bien al bot
//      de WhatsApp (contrato v1.57). No se retrocede este mismo fallback a
//      `PostgresReporteMargenQueryRepository` en esta entrada — separado,
//      pendiente, ver changelog.
//
// Se resuelve la categoría con `COALESCE(ctd.categoria, pm.categoria)`: para
// líneas con `producto_id`, esto también repara "gratis" cualquier fila
// grabada ANTES de que existiera la columna `categoria` (v1.58) — no hace
// falta backfill/UPDATE de datos históricos, porque `productos_maestro.categoria`
// ya es NOT NULL para las 5 filas del catálogo cruzado.
//
// Solo lectura, sin transacción explícita (mismo criterio que el resto de
// `consulta-reportes`).

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';
import type { CategoriaProducto } from '@fuelhub/shared-kernel';
import type { FiltrosReporteDia, ReporteDiaDTO, ReporteDiaProductoDTO, ReporteDiaQueryRepository } from '../../application/ports/ReporteDiaQueryRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresReporteDiaQueryRepository implements ReporteDiaQueryRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async obtener(filtros: FiltrosReporteDia): Promise<ReporteDiaDTO | null> {
    const parametros: SqlParameter[] = [
      { name: 'estacionCodigo', value: { stringValue: filtros.estacionCodigo } },
      { name: 'fechaNegocio', value: { stringValue: filtros.fechaNegocio } },
    ];

    const cierreDia = await this.obtenerCierreDia(parametros);
    if (cierreDia === null) return null;

    const productos = await this.obtenerProductos(parametros);
    const totales = productos.reduce(
      (acc, p) => {
        if (p.categoria === 'COMBUSTIBLE') acc.totalCombustible += p.ingresos;
        else if (p.categoria === 'NO_COMBUSTIBLE') acc.totalNoCombustible += p.ingresos;
        else acc.totalSinClasificar += p.ingresos;
        return acc;
      },
      { totalCombustible: 0, totalNoCombustible: 0, totalSinClasificar: 0 }
    );

    return {
      estacionCodigo: filtros.estacionCodigo,
      fechaNegocio: filtros.fechaNegocio,
      cierreDiaId: cierreDia.id,
      total: cierreDia.total,
      ...totales,
      productos,
    };
  }

  private async obtenerCierreDia(parametros: SqlParameter[]): Promise<{ id: string; total: number } | null> {
    // ORDER BY + LIMIT 1 defensivo: `cierres_dia` no tiene un UNIQUE
    // (estacion_id, fecha_negocio) — solo `clave_idempotencia` es única — así
    // que dos claves de idempotencia distintas podrían, en teoría, generar
    // dos cierres de día "activos" para el mismo día/estación. No se corrige
    // ese hueco de modelo acá (fuera de alcance); esto solo evita que este
    // endpoint reviente si algún día pasa, quedándose con el más reciente.
    const sql = `
      SELECT cd.id, cd.total
      FROM cierres_dia cd
      JOIN estaciones e ON e.id = cd.estacion_id
      WHERE e.codigo = :estacionCodigo
        AND cd.fecha_negocio = :fechaNegocio
        AND cd.estado = 'ACTIVO'
      ORDER BY cd.recibido_en DESC
      LIMIT 1
    `;
    const filas = await this.ejecutar(sql, parametros);
    const fila = filas[0];
    if (fila === undefined) return null;
    return { id: String(fila.id), total: Number(fila.total) };
  }

  private async obtenerProductos(parametros: SqlParameter[]): Promise<ReporteDiaProductoDTO[]> {
    const sql = `
      SELECT ctd.producto_id                              AS producto_id,
             COALESCE(pm.nombre, ctd.producto_nombre)      AS producto,
             COALESCE(ctd.categoria, pm.categoria)          AS categoria,
             SUM(COALESCE(ctd.despacho_cantidad, ctd.total_cantidad, 0)) AS cantidad_vendida,
             SUM(COALESCE(ctd.despacho_soles, ctd.total_soles, 0))       AS ingresos
      FROM cierres_turno_detalle ctd
      JOIN cierres_turno ct           ON ct.id = ctd.cierre_turno_id
      JOIN estaciones e                ON e.id = ct.estacion_id
      LEFT JOIN productos_maestro pm  ON pm.id = ctd.producto_id
      WHERE e.codigo = :estacionCodigo
        AND ct.fecha_negocio = :fechaNegocio
        AND ct.estado = 'ACTIVO'
      GROUP BY ctd.producto_id, COALESCE(pm.nombre, ctd.producto_nombre), COALESCE(ctd.categoria, pm.categoria)
      ORDER BY ingresos DESC
    `;
    const filas = await this.ejecutar(sql, parametros);
    return filas.map(mapearFilaProducto);
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

function mapearFilaProducto(fila: Record<string, unknown>): ReporteDiaProductoDTO {
  return {
    productoId: fila.producto_id === null || fila.producto_id === undefined ? null : String(fila.producto_id),
    producto: String(fila.producto),
    categoria: (fila.categoria as CategoriaProducto | null | undefined) ?? null,
    cantidadVendida: Number(fila.cantidad_vendida),
    ingresos: Number(fila.ingresos),
  };
}
