// infrastructure/adapters/PostgresCompraCorreoRepository.ts
//
// Implementación real de `CompraCorreoRepository` (v1.81) -- mismo patrón
// de conexión que el resto de adaptadores del repo (RDS Data API vía
// `@aws-sdk/client-rds-data`, sección 9.4/12.5: es la única vía de acceso
// real al cluster, subred privada sin NAT). A diferencia de
// `PostgresCompraIngestaRepository` (flujo manual), acá NO hace falta una
// transacción explícita -- cada operación de este puerto es un único
// statement (o, en `registrarCompra`, un INSERT ... RETURNING de una sola
// fila) sin pasos intermedios que deban revertirse juntos.
//
// OJO CAST (bug real ya cometido una vez en este repo, v1.80 -- ver
// `PostgresCompraIngestaRepository`/changelog): todo parámetro de RDS Data
// API comparado o asignado contra una columna de tipo ENUM necesita
// `CAST(:param AS <tipo>)` explícito -- acá van DOS: `categoria` contra
// `categoria_producto` y `estado` contra `estado_compra` (el tipo propio de
// `compras` desde la migración 1788600000000, NO `estado_cierre`).
//
// `ComprobanteDuplicadoError` (ver cabecera del puerto): el índice único
// parcial `ux_compras_proveedor_comprobante_linea` (migración 1788700000000)
// es la garantía real contra duplicados -- `existeComprobante` (chequeo
// previo del caso de uso) es solo una optimización para evitar el roundtrip
// en el caso común. Si de todas formas el INSERT choca (carrera entre
// corridas del Lambda), Postgres devuelve SQLSTATE 23505
// ("duplicate key value violates unique constraint") -- RDS Data API lo
// sube como una excepción cuyo `.message` incluye el texto del error del
// motor; `esErrorDeClaveDuplicada` lo detecta por substring en vez de por
// un código tipado porque el SDK no expone un campo `code` estructurado
// para esto (a diferencia de un cliente `pg` directo, que sí tendría
// `err.code === '23505'` -- no es una opción acá, ver comentario de
// cabecera de `aurora-data-api-db-client.mjs` sobre por qué Data API es la
// única vía).

import {
  ExecuteStatementCommand,
  RDSDataClient,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { conReintentoSiDbEstaResumiendo, type CategoriaProducto } from '@fuelhub/shared-kernel';
import type {
  CompraCorreoRepository,
  ConfiguracionCorreoEstacion,
  DatosCompraCorreoAInsertar,
  EstacionPorRuc,
  ProductoActivo,
} from '../../application/ports/CompraCorreoRepository';
import { ComprobanteDuplicadoError } from '../../application/ports/CompraCorreoRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresCompraCorreoRepository implements CompraCorreoRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async buscarEstacionPorRuc(ruc: string): Promise<EstacionPorRuc | undefined> {
    const filas = await this.ejecutar(
      'SELECT id, codigo FROM estaciones WHERE ruc = :ruc AND activo = true',
      [paramText('ruc', ruc)]
    );
    const fila = filas[0];
    return fila ? { id: String(fila.id), codigo: String(fila.codigo) } : undefined;
  }

  async listarProductosActivos(): Promise<readonly ProductoActivo[]> {
    const filas = await this.ejecutar('SELECT id, nombre, alias, categoria FROM productos_maestro WHERE activo = true ORDER BY nombre', []);
    return filas.map((fila) => ({
      id: String(fila.id),
      nombre: String(fila.nombre),
      alias: fila.alias === null || fila.alias === undefined ? null : String(fila.alias),
      categoria: fila.categoria as CategoriaProducto,
    }));
  }

  async existeComprobante(proveedorRuc: string, numeroComprobante: string, numeroLineaComprobante: string): Promise<boolean> {
    const filas = await this.ejecutar(
      `SELECT 1 FROM compras
       WHERE proveedor_ruc = :proveedorRuc AND numero_comprobante = :numeroComprobante AND numero_linea_comprobante = :numeroLineaComprobante
       LIMIT 1`,
      [
        paramText('proveedorRuc', proveedorRuc),
        paramText('numeroComprobante', numeroComprobante),
        paramText('numeroLineaComprobante', numeroLineaComprobante),
      ]
    );
    return filas.length > 0;
  }

  async registrarCompra(datos: DatosCompraCorreoAInsertar): Promise<{ id: string }> {
    let filas: Record<string, unknown>[];
    try {
      filas = await this.ejecutar(
        `INSERT INTO compras (
           estacion_id, producto_id, producto_nombre, categoria, proveedor, fecha, cantidad, costo_unitario,
           origen, proveedor_ruc, numero_comprobante, numero_linea_comprobante, estado
         )
         VALUES (
           CAST(:estacionId AS uuid), CAST(:productoId AS uuid), :productoNombre, CAST(:categoria AS categoria_producto), :proveedor,
           CAST(:fecha AS timestamptz), :cantidad, :costoUnitario,
           'CORREO', :proveedorRuc, :numeroComprobante, :numeroLineaComprobante, CAST(:estado AS estado_compra)
         )
         RETURNING id`,
        [
          paramText('estacionId', datos.estacionId),
          paramText('productoId', datos.productoId),
          paramText('productoNombre', datos.productoNombre),
          paramText('categoria', datos.categoria),
          paramText('proveedor', datos.proveedor),
          paramText('fecha', datos.fecha),
          paramDecimal('cantidad', datos.cantidad),
          paramDecimal('costoUnitario', datos.costoUnitario),
          paramText('proveedorRuc', datos.proveedorRuc),
          paramText('numeroComprobante', datos.numeroComprobante),
          paramText('numeroLineaComprobante', datos.numeroLineaComprobante),
          paramText('estado', datos.estado),
        ]
      );
    } catch (err) {
      if (esErrorDeClaveDuplicada(err)) {
        throw new ComprobanteDuplicadoError(datos.proveedorRuc, datos.numeroComprobante, datos.numeroLineaComprobante);
      }
      throw err;
    }

    const fila = filas[0];
    if (!fila) throw new Error('El INSERT de compras (correo) no devolvió fila (inesperado).');
    return { id: String(fila.id) };
  }

  async listarConfiguracionesCorreoActivas(): Promise<readonly ConfiguracionCorreoEstacion[]> {
    const filas = await this.ejecutar(
      `SELECT estacion_id, nombre_secreto_gmail, etiqueta_gmail
       FROM estaciones_correo_proveedores
       WHERE activo = true`,
      []
    );
    return filas.map((fila) => ({
      estacionId: String(fila.estacion_id),
      nombreSecretoGmail: String(fila.nombre_secreto_gmail),
      // `null` desde la migración 1788900000000 -- ver comentario de
      // `ConfiguracionCorreoEstacion` en el puerto.
      etiquetaGmail: fila.etiqueta_gmail === null || fila.etiqueta_gmail === undefined ? null : String(fila.etiqueta_gmail),
    }));
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

/** Ver nota de cabecera -- Data API no expone un código de error estructurado, se detecta por el texto del mensaje. */
function esErrorDeClaveDuplicada(err: unknown): boolean {
  const mensaje = err instanceof Error ? err.message : String(err);
  return /duplicate key value violates unique constraint|ux_compras_proveedor_comprobante_linea|SQLSTATE 23505/i.test(mensaje);
}

function paramText(name: string, value: string | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: value } };
}

function paramDecimal(name: string, value: number): SqlParameter {
  return { name, value: { stringValue: String(value) }, typeHint: 'DECIMAL' };
}
