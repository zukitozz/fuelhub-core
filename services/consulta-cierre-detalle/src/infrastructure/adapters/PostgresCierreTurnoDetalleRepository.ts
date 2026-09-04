// infrastructure/adapters/PostgresCierreTurnoDetalleRepository.ts
//
// Igual que en consulta-cierres: única capa que conoce RDS Data API y el
// esquema real en snake_case (sección 3.3). Se arman 3 consultas en paralelo
// (cabecera + pagos + detalle) porque son tablas separadas 1:N sobre
// `cierres_turno` — más simple y legible que un único JOIN con filas
// duplicadas para agregar en memoria.
//
// CORRECCIÓN v1.34: las columnas de `cierres_turno_pagos`/`cierres_turno_detalle`
// consultadas acá antes no existían en el DDL real (sección 3.3) — ver el
// comentario en el puerto (`CierreTurnoDetalleRepository.ts`). Esta versión usa
// las columnas reales: `medio_pago`, `producto_id`, `producto_codigo_local`,
// `producto_nombre`, `medida`, `total_cantidad`, `total_soles`,
// `calibracion_cantidad`, `calibracion_soles`, `despacho_cantidad`, `despacho_soles`.

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';
import { conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
import type { CategoriaProducto, CierreTurnoDetalleDTO, DetalleLinea, Pago } from '@fuelhub/shared-kernel';
import type { CierreTurnoDetalleRepository } from '../../application/ports/CierreTurnoDetalleRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresCierreTurnoDetalleRepository implements CierreTurnoDetalleRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async obtenerPorId(id: string): Promise<CierreTurnoDetalleDTO | undefined> {
    // CAST(:id AS uuid) en las 3 consultas de abajo -- v1.51, descubierto en
    // el primer test:integration real: RDS Data API manda el parámetro sin
    // tipo explícito y Postgres no tiene cast implícito de texto a uuid.
    const sqlCabecera = `
      SELECT ct.id, e.codigo AS codigo_estacion, ct.isla, ct.turno, ct.fecha_negocio,
             ct.fecha_inicio, ct.fecha, ct.total, ct.estado,
             u.usuario AS empleado_codigo, u.nombre AS empleado_nombre, ct.recibido_en,
             ct.cierre_dia_id, ct.facturas_emitidas, ct.cliente_origen
      FROM cierres_turno ct
      JOIN estaciones e ON e.id = ct.estacion_id
      LEFT JOIN usuarios u ON u.id = ct.usuario_id
      WHERE ct.id = CAST(:id AS uuid)
    `;

    const filasCabecera = await this.ejecutar(sqlCabecera, [param('id', id)]);
    const cabecera = filasCabecera[0];
    if (!cabecera) return undefined;

    const [pagos, detalle] = await Promise.all([
      this.ejecutar(
        `SELECT medio_pago, monto FROM cierres_turno_pagos WHERE cierre_turno_id = CAST(:id AS uuid) ORDER BY medio_pago`,
        [param('id', id)]
      ),
      this.ejecutar(
        `SELECT producto_id, producto_codigo_local, producto_nombre, medida, total_cantidad, total_soles,
                calibracion_cantidad, calibracion_soles, despacho_cantidad, despacho_soles, categoria
         FROM cierres_turno_detalle WHERE cierre_turno_id = CAST(:id AS uuid) ORDER BY id`,
        [param('id', id)]
      ),
    ]);

    return mapearCabecera(cabecera, pagos.map(mapearPago), detalle.map(mapearDetalleLinea));
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

function param(name: string, value: string | number): SqlParameter {
  return typeof value === 'number' ? { name, value: { longValue: value } } : { name, value: { stringValue: value } };
}

function numeroONull(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : Number(valor);
}

function textoONull(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : String(valor);
}

function mapearPago(fila: Record<string, unknown>): Pago {
  return { medio: String(fila.medio_pago), monto: Number(fila.monto) };
}

function mapearDetalleLinea(fila: Record<string, unknown>): DetalleLinea {
  return {
    productoId: textoONull(fila.producto_id),
    codigoLocal: textoONull(fila.producto_codigo_local),
    producto: String(fila.producto_nombre),
    medida: textoONull(fila.medida),
    totalCantidad: Number(fila.total_cantidad),
    totalSoles: Number(fila.total_soles),
    calibracionCantidad: numeroONull(fila.calibracion_cantidad),
    calibracionSoles: numeroONull(fila.calibracion_soles),
    despachoCantidad: numeroONull(fila.despacho_cantidad),
    despachoSoles: numeroONull(fila.despacho_soles),
    categoria: (textoONull(fila.categoria) as CategoriaProducto | null) ?? null,
  };
}

function mapearCabecera(
  fila: Record<string, unknown>,
  pagos: readonly Pago[],
  detalle: readonly DetalleLinea[]
): CierreTurnoDetalleDTO {
  return {
    id: String(fila.id),
    codigoEstacion: String(fila.codigo_estacion),
    isla: textoONull(fila.isla),
    turno: fila.turno as CierreTurnoDetalleDTO['turno'],
    fechaNegocio: String(fila.fecha_negocio),
    fechaInicio: String(fila.fecha_inicio),
    fecha: String(fila.fecha),
    total: Number(fila.total),
    estado: fila.estado as CierreTurnoDetalleDTO['estado'],
    empleado: { codigo: String(fila.empleado_codigo ?? ''), nombre: String(fila.empleado_nombre ?? '') },
    recibidoEn: String(fila.recibido_en),
    cierreDiaId: textoONull(fila.cierre_dia_id),
    facturasEmitidas: Number(fila.facturas_emitidas ?? 0),
    clienteOrigen: String(fila.cliente_origen ?? ''),
    pagos,
    detalle,
  };
}
