// infrastructure/adapters/ExcelReporteComprasSemanalRenderer.ts
//
// Primer uso de `exceljs` en el repo (v1.86) -- hasta ahora todos los
// documentos de reporte eran PDF (`pdfkit`). Columnas pedidas por Jorge:
// Producto, Volumen, Fecha Inicio, Fecha Fin -- una fila por producto
// combustible; si la semana no tuvo compras, el Excel sale con cabecera y
// cero filas de datos (no se omite la generación, ver la nota de cabecera
// del puerto).

import ExcelJS from 'exceljs';
import type { ReporteComprasSemanalRendererPort } from '../../application/ports/ReporteComprasSemanalDocumentoPorts';

export class ExcelReporteComprasSemanalRenderer implements ReporteComprasSemanalRendererPort {
  async renderizarExcel(params: {
    readonly estacionCodigo: string;
    readonly fechaInicio: string;
    readonly fechaFin: string;
    readonly items: readonly { readonly producto: string; readonly volumen: number }[];
  }): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet(`Compras ${params.estacionCodigo}`);

    hoja.columns = [
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Volumen', key: 'volumen', width: 15 },
      { header: 'Fecha Inicio', key: 'fechaInicio', width: 15 },
      { header: 'Fecha Fin', key: 'fechaFin', width: 15 },
    ];
    hoja.getRow(1).font = { bold: true };

    for (const item of params.items) {
      hoja.addRow({
        producto: item.producto,
        volumen: item.volumen,
        fechaInicio: params.fechaInicio,
        fechaFin: params.fechaFin,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
