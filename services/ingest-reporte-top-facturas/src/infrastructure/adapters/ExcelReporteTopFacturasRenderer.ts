// infrastructure/adapters/ExcelReporteTopFacturasRenderer.ts
//
// Una fila por FACTURA (no por cliente) -- a diferencia de
// ExcelReporteComprasSemanalRenderer.ts (una fila por producto), acá la
// señal de fraude que le importa a Jorge es la combinación cliente+factura+
// despachador, así que aplanar a nivel factura deja esa relación visible en
// cada fila sin necesitar celdas combinadas. `Total Cliente (semana)` se
// repite en cada fila del mismo cliente a propósito (mismo criterio simple
// que ya usa compras-semanal con fechaInicio/fechaFin repetidos por fila).
//
// Si `top` viene vacío (semana sin clientes destacados), el Excel sale con
// cabecera y cero filas -- mismo criterio que compras-semanal: siempre se
// genera, nunca se omite.

import ExcelJS from 'exceljs';
import type { ClienteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';
import type { ReporteTopFacturasRendererPort } from '../../application/ports/ReporteTopFacturasRendererPort';

export class ExcelReporteTopFacturasRenderer implements ReporteTopFacturasRendererPort {
  async renderizarExcel(params: {
    readonly codigoEstacion: string;
    readonly semanaInicio: string;
    readonly top: readonly ClienteTopFacturasInput[];
  }): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet(`Top Facturas ${params.codigoEstacion}`);

    hoja.columns = [
      { header: 'Documento Cliente', key: 'documentoCliente', width: 18 },
      { header: 'Nombre Cliente', key: 'nombreCliente', width: 30 },
      { header: 'Total Cliente (semana)', key: 'totalCliente', width: 20 },
      { header: 'Numeración', key: 'numeracion', width: 16 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Monto', key: 'monto', width: 14 },
      { header: 'Despachador', key: 'despachador', width: 24 },
      { header: 'DNI Despachador', key: 'dniDespachador', width: 16 },
    ];
    hoja.getRow(1).font = { bold: true };

    for (const cliente of params.top) {
      for (const factura of cliente.facturas) {
        hoja.addRow({
          documentoCliente: cliente.numeroDocumentoCliente,
          nombreCliente: cliente.nombreCliente,
          totalCliente: cliente.totalSoles,
          numeracion: factura.numeracion,
          fecha: factura.fecha,
          monto: factura.monto,
          despachador: factura.despachadorNombre,
          dniDespachador: factura.despachadorDocumento,
        });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
