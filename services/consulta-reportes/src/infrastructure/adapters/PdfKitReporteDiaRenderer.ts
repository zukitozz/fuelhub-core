// infrastructure/adapters/PdfKitReporteDiaRenderer.ts
//
// Implementa ReporteDiaRendererPort (v1.60) con `pdfkit` -- se eligió PDF en
// vez de imagen (PNG/JPEG) a propósito: pdfkit es una librería JS pura, sin
// navegador headless (Chromium) de por medio -- mucho más liviana y rápida
// de arrancar en un Lambda que Puppeteer/Playwright, y con menos riesgo de
// pegarle al timeout (ver AuthenticatedEndpoint, timeout de este endpoint en
// api-stack.ts). El diseño visual es deliberadamente simple -- el contrato
// con notificaciones-whatsapp (v1.60) solo exige que el PDF sea legible, no
// define ningún estándar visual.

import PDFDocument from 'pdfkit';
import type { ReporteDiaDTO } from '../../application/ports/ReporteDiaQueryRepository';
import type { ReporteDiaDocumentoDatos, ReporteDiaRendererPort } from '../../application/ports/ReporteDiaDocumentoPorts';

export class PdfKitReporteDiaRenderer implements ReporteDiaRendererPort {
  async renderizarPdf(datos: ReporteDiaDocumentoDatos): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finalizado = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    if (datos.modo === 'individual') {
      this.renderizarEstacion(doc, datos.reporte);
    } else {
      this.renderizarResumenConsolidado(doc, datos.fechaNegocio, datos.reportes);
      for (const reporte of datos.reportes) {
        doc.addPage();
        this.renderizarEstacion(doc, reporte);
      }
    }

    doc.end();
    return finalizado;
  }

  private renderizarResumenConsolidado(doc: PDFKit.PDFDocument, fechaNegocio: string, reportes: readonly ReporteDiaDTO[]): void {
    doc.fontSize(18).text(`Reporte consolidado del día -- ${fechaNegocio}`, { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    let totalGeneral = 0;
    for (const r of reportes) {
      doc.text(`${r.estacionCodigo}:  S/ ${r.total.toFixed(2)}`);
      totalGeneral += r.total;
    }
    doc.moveDown(0.5);
    doc.fontSize(13).text(`Total todas las estaciones: S/ ${totalGeneral.toFixed(2)}`, { underline: true });
  }

  private renderizarEstacion(doc: PDFKit.PDFDocument, reporte: ReporteDiaDTO): void {
    doc.fontSize(18).text(`Reporte del día -- ${reporte.estacionCodigo}`, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Fecha de negocio: ${reporte.fechaNegocio}`);
    doc.text(`Total del día: S/ ${reporte.total.toFixed(2)}`);
    doc.text(`Combustible: S/ ${reporte.totalCombustible.toFixed(2)}`);
    doc.text(`No combustible: S/ ${reporte.totalNoCombustible.toFixed(2)}`);
    if (reporte.totalSinClasificar > 0) {
      doc.text(`Sin clasificar: S/ ${reporte.totalSinClasificar.toFixed(2)}`);
    }
    doc.moveDown();

    doc.fontSize(12).text('Detalle por producto', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    if (reporte.productos.length === 0) {
      doc.text('(sin líneas de detalle)');
    }
    for (const p of reporte.productos) {
      const categoria = p.categoria ?? 'SIN CLASIFICAR';
      doc.text(`${p.producto}  |  ${categoria}  |  cant: ${p.cantidadVendida}  |  S/ ${p.ingresos.toFixed(2)}`);
    }
    doc.moveDown();
  }
}
