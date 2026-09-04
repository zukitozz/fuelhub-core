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
//
// v1.62 -- a pedido de Jorge ("apóyate de los cierres de turno que
// corresponden al cierre de día", con capturas de referencia de reportes
// de su sistema legado), el PDF deja de mostrar solo el total del día y
// pasa a mostrar, primero, el desglose turno por turno (cada uno con su
// propia tabla de productos y su propio total -- igual que las secciones
// "REPORTE TURNO" de esas capturas), y recién al final el resumen
// consolidado del día completo (mismos totales que ya mostraba antes).

import PDFDocument from 'pdfkit';
import type { ReporteDiaTurnoDTO } from '../../application/ports/ReporteDiaQueryRepository';
import type {
  ReporteDiaDocumentoDatos,
  ReporteDiaEstacionDocumentoDTO,
  ReporteDiaRendererPort,
} from '../../application/ports/ReporteDiaDocumentoPorts';

const ETIQUETA_TURNO: Record<ReporteDiaTurnoDTO['turno'], string> = {
  TURNO1: 'Turno 1',
  TURNO2: 'Turno 2',
  TURNO3: 'Turno 3',
};

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
      this.renderizarEstacion(doc, datos.estacion);
    } else {
      this.renderizarResumenConsolidado(doc, datos.fechaNegocio, datos.estaciones);
      for (const estacion of datos.estaciones) {
        doc.addPage();
        this.renderizarEstacion(doc, estacion);
      }
    }

    doc.end();
    return finalizado;
  }

  private renderizarResumenConsolidado(doc: PDFKit.PDFDocument, fechaNegocio: string, estaciones: readonly ReporteDiaEstacionDocumentoDTO[]): void {
    doc.fontSize(18).text(`Reporte consolidado del día -- ${fechaNegocio}`, { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    let totalGeneral = 0;
    for (const { reporte } of estaciones) {
      doc.text(`${reporte.estacionCodigo}:  S/ ${reporte.total.toFixed(2)}`);
      totalGeneral += reporte.total;
    }
    doc.moveDown(0.5);
    doc.fontSize(13).text(`Total todas las estaciones: S/ ${totalGeneral.toFixed(2)}`, { underline: true });
  }

  private renderizarEstacion(doc: PDFKit.PDFDocument, estacion: ReporteDiaEstacionDocumentoDTO): void {
    const { reporte, turnos } = estacion;

    doc.fontSize(18).text(`Reporte del día -- ${reporte.estacionCodigo}`, { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11).text(`Fecha de negocio: ${reporte.fechaNegocio}`);
    doc.moveDown();

    // --- Desglose por turno (v1.62) -----------------------------------
    doc.fontSize(14).text('Detalle por turno', { underline: true });
    doc.moveDown(0.3);

    if (turnos.length === 0) {
      doc.fontSize(10).text('(no se registraron cierres de turno individuales para este día -- el cierre de día se recibió sin turnos asociados)');
      doc.moveDown();
    } else {
      for (const turno of turnos) {
        this.renderizarTurno(doc, turno);
      }
    }

    // --- Resumen del día completo (mismos totales que ya mostraba el PDF
    // antes de v1.62 -- suma de TODOS los turnos del día, no solo los de
    // arriba, por si algún turno quedara fuera de listarTurnos por alguna
    // razón futura: reporte.total siempre viene de cierres_dia, fuente de
    // verdad independiente). --------------------------------------------
    doc.moveDown(0.5);
    doc.fontSize(14).text('Resumen del día', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11);
    doc.text(`Total del día: S/ ${reporte.total.toFixed(2)}`);
    doc.text(`Combustible: S/ ${reporte.totalCombustible.toFixed(2)}`);
    doc.text(`No combustible: S/ ${reporte.totalNoCombustible.toFixed(2)}`);
    if (reporte.totalSinClasificar > 0) {
      doc.text(`Sin clasificar: S/ ${reporte.totalSinClasificar.toFixed(2)}`);
    }
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

  private renderizarTurno(doc: PDFKit.PDFDocument, turno: ReporteDiaTurnoDTO): void {
    doc.fontSize(12).text(`${ETIQUETA_TURNO[turno.turno]}  --  ${turno.empleado}`, { continued: false });
    doc.fontSize(9).fillColor('#555555').text(`Inicio: ${turno.fechaInicio}   Fin: ${turno.fecha}`);
    doc.fillColor('#000000');
    doc.moveDown(0.2);

    doc.fontSize(9);
    if (turno.productos.length === 0) {
      doc.text('(sin líneas de detalle)');
    }
    for (const p of turno.productos) {
      const categoria = p.categoria ?? 'SIN CLASIFICAR';
      doc.text(`   ${p.producto}  |  ${categoria}  |  cant: ${p.cantidadVendida}  |  S/ ${p.ingresos.toFixed(2)}`);
    }
    doc.fontSize(10).text(`   Total del turno: S/ ${turno.total.toFixed(2)}`, { underline: true });
    doc.moveDown(0.6);
  }
}
