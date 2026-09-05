// infrastructure/adapters/PdfKitReporteDiaRenderer.ts
//
// Implementa ReporteDiaRendererPort (v1.60) con `pdfkit` -- se eligió PDF en
// vez de imagen (PNG/JPEG) a propósito: pdfkit es una librería JS pura, sin
// navegador headless (Chromium) de por medio -- mucho más liviana y rápida
// de arrancar en un Lambda que Puppeteer/Playwright, y con menos riesgo de
// pegarle al timeout (ver AuthenticatedEndpoint, timeout de este endpoint en
// api-stack.ts).
//
// v1.62 -- a pedido de Jorge ("apóyate de los cierres de turno que
// corresponden al cierre de día"), el PDF individual agrega un desglose
// turno por turno antes del resumen del día.
//
// v1.63 -- Jorge mandó capturas reales de los reportes de su sistema
// legado y pidió que el PDF se pareciera más a eso: tablas con bordes,
// banda de título de color, y una fila de subtotal resaltada para las
// líneas de combustible (con las líneas no-combustible listadas debajo,
// SIN sumar a ese subtotal -- así se ven sus paneles "GRUPO ..."). Se
// confirmó con Jorge (2 preguntas): (1) esto se AGREGA encima del
// desglose por turno de v1.62, no lo reemplaza -- tanto cada turno como el
// resumen del día ahora se dibujan con esta tabla; (2) el modo CONSOLIDADO
// pasa de una página de texto plano + una página completa por estación, a
// una portada tipo "mosaico" (grilla de 2 columnas, una caja por estación
// con su tabla de productos del día) parecida a la captura -- seguida
// igual que antes por una página de detalle completa por estación (con su
// desglose por turno), para no perder esa información.
//
// Limitación conocida, sin resolver en esta entrada: las capturas de
// referencia de Jorge traen una columna "Ventas" (conteo de despachos/
// transacciones) que el modelo de datos de FuelHub HOY no captura en
// ningún lado -- `cierres_turno_detalle` solo guarda cantidad (volumen) e
// importe (soles) por línea, nunca un conteo de operaciones. Se omite esa
// columna acá en vez de inventar un número; si Jorge la necesita de
// verdad, hace falta agregarla al contrato de ingesta primero (fuera de
// alcance de un cambio de renderizado).
//
// Todas las tablas de productos usan el mismo criterio de categoría que ya
// existe en el DTO (v1.58): `categoria === 'COMBUSTIBLE'` va arriba con un
// subtotal resaltado (calculado sumando SOLO las líneas visibles en esa
// misma tabla, para que el subtotal nunca pueda contradecir lo que se ve
// arriba de él); todo lo demás (`NO_COMBUSTIBLE` o sin clasificar) se
// lista debajo sin sumar a ese subtotal. El total autoritativo de cada
// nivel (turno.total / reporte.total, ambos "fuente de verdad" reportados
// por el POS -- sección 3.9/v1.59) se muestra aparte, DEBAJO de la tabla,
// nunca recalculado a partir del detalle.

import PDFDocument from 'pdfkit';
import type { ReporteDiaProductoDTO, ReporteDiaTurnoDTO } from '../../application/ports/ReporteDiaQueryRepository';
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

// --- Estilo de tabla "reporte legado" (v1.63) -------------------------------

const ALTO_FILA = 16;
const COLOR_BORDE = '#000000';
const COLOR_BANDA_TITULO = '#FFEB3B'; // banda amarilla -- nombre de estación/turno
const COLOR_ENCABEZADO_TABLA = '#E0E0E0'; // gris claro -- fila "Producto/Cantidad/Total"
const COLOR_SUBTOTAL = '#FFF59D'; // amarillo suave -- fila de subtotal de combustible

function formatearCantidad(n: number): string {
  return n.toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatearMonto(n: number): string {
  return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Evita dibujar fuera del área imprimible de la página: si lo que sigue no
 * entra, agrega una página nueva y devuelve el Y de arranque de esa página.
 * Simplificación deliberada: no repite encabezados de tabla al saltar de
 * página a mitad de una tabla larga -- aceptable hoy porque ninguna
 * estación real tiene más de un puñado de líneas de detalle (sección
 * 3.8.1), pero quedaría raro con un catálogo de "mercadito" muy largo.
 */
function asegurarEspacio(doc: PDFKit.PDFDocument, y: number, alturaNecesaria: number): number {
  const limiteInferior = doc.page.height - doc.page.margins.bottom;
  if (y + alturaNecesaria > limiteInferior) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

function dibujarFilaTabla(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  anchos: readonly [number, number, number],
  celdas: readonly [string, string, string],
  opciones: { negrita?: boolean; relleno?: string } = {}
): void {
  const anchoTotal = anchos[0] + anchos[1] + anchos[2];
  if (opciones.relleno) {
    doc.rect(x, y, anchoTotal, ALTO_FILA).fillAndStroke(opciones.relleno, COLOR_BORDE);
  } else {
    doc.rect(x, y, anchoTotal, ALTO_FILA).stroke(COLOR_BORDE);
  }
  doc.fillColor('#000000').font(opciones.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
  doc.text(celdas[0], x + 3, y + 4, { width: anchos[0] - 6, lineBreak: false });
  doc.text(celdas[1], x + anchos[0], y + 4, { width: anchos[1] - 6, align: 'right', lineBreak: false });
  doc.text(celdas[2], x + anchos[0] + anchos[1], y + 4, { width: anchos[2] - 6, align: 'right', lineBreak: false });
}

/**
 * Dibuja una tabla de productos completa (banda de título + encabezado de
 * columnas + líneas de combustible + subtotal resaltado + líneas no
 * combustible) a partir de X,Y dado, con el ancho indicado -- se usa tanto
 * para cada turno individual como para el resumen del día de una estación,
 * y para cada caja de la grilla del consolidado (v1.63). Devuelve el Y
 * donde terminó, para que el llamador siga dibujando debajo.
 */
function dibujarTablaProductos(
  doc: PDFKit.PDFDocument,
  x: number,
  yInicial: number,
  ancho: number,
  titulo: string,
  productos: readonly ReporteDiaProductoDTO[],
  subtitulo?: string
): number {
  let y = yInicial;
  const anchoProducto = Math.round(ancho * 0.48);
  const anchoCantidad = Math.round(ancho * 0.24);
  const anchoTotal = ancho - anchoProducto - anchoCantidad;
  const anchos: [number, number, number] = [anchoProducto, anchoCantidad, anchoTotal];

  y = asegurarEspacio(doc, y, ALTO_FILA * 3);
  doc.rect(x, y, ancho, ALTO_FILA).fillAndStroke(COLOR_BANDA_TITULO, COLOR_BORDE);
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9).text(titulo, x + 4, y + 4, { width: ancho - 8, lineBreak: false });
  y += ALTO_FILA;

  if (subtitulo) {
    y = asegurarEspacio(doc, y, 12);
    doc.fillColor('#555555').font('Helvetica').fontSize(7).text(subtitulo, x + 2, y + 1, { width: ancho - 4 });
    doc.fillColor('#000000');
    y += 12;
  }

  y = asegurarEspacio(doc, y, ALTO_FILA);
  dibujarFilaTabla(doc, x, y, anchos, ['Producto', 'Cantidad', 'Total'], { negrita: true, relleno: COLOR_ENCABEZADO_TABLA });
  y += ALTO_FILA;

  const combustible = productos.filter((p) => p.categoria === 'COMBUSTIBLE');
  const otros = productos.filter((p) => p.categoria !== 'COMBUSTIBLE');
  const subtotalCombustible = combustible.reduce(
    (acc, p) => ({ cantidad: acc.cantidad + p.cantidadVendida, total: acc.total + p.ingresos }),
    { cantidad: 0, total: 0 }
  );

  for (const p of combustible) {
    y = asegurarEspacio(doc, y, ALTO_FILA);
    dibujarFilaTabla(doc, x, y, anchos, [p.producto, formatearCantidad(p.cantidadVendida), formatearMonto(p.ingresos)]);
    y += ALTO_FILA;
  }

  if (combustible.length > 0) {
    y = asegurarEspacio(doc, y, ALTO_FILA);
    dibujarFilaTabla(doc, x, y, anchos, ['', formatearCantidad(subtotalCombustible.cantidad), formatearMonto(subtotalCombustible.total)], {
      negrita: true,
      relleno: COLOR_SUBTOTAL,
    });
    y += ALTO_FILA;
  }

  for (const p of otros) {
    y = asegurarEspacio(doc, y, ALTO_FILA);
    dibujarFilaTabla(doc, x, y, anchos, [p.producto, formatearCantidad(p.cantidadVendida), formatearMonto(p.ingresos)]);
    y += ALTO_FILA;
  }

  if (productos.length === 0) {
    y = asegurarEspacio(doc, y, ALTO_FILA);
    dibujarFilaTabla(doc, x, y, anchos, ['(sin líneas de detalle)', '', '']);
    y += ALTO_FILA;
  }

  return y;
}

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
      this.renderizarPortadaConsolidada(doc, datos.fechaNegocio, datos.estaciones);
      for (const estacion of datos.estaciones) {
        doc.addPage();
        this.renderizarEstacion(doc, estacion);
      }
    }

    doc.end();
    return finalizado;
  }

  /**
   * Portada del consolidado (v1.63): grilla de 2 columnas, una caja por
   * estación con su tabla de productos del día -- parecido a la captura de
   * referencia de Jorge (varios paneles "GRIFO ..."/"GRUPO ..." en una
   * sola hoja). Las páginas de detalle completo por estación (con su
   * desglose por turno) siguen viniendo después, sin cambios de v1.62.
   */
  private renderizarPortadaConsolidada(doc: PDFKit.PDFDocument, fechaNegocio: string, estaciones: readonly ReporteDiaEstacionDocumentoDTO[]): void {
    doc.fontSize(18).text(`Reporte consolidado del día -- ${fechaNegocio}`, { underline: true });
    doc.moveDown();

    const x = doc.page.margins.left;
    const anchoDisponible = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const espacioEntreCajas = 16;
    const anchoCaja = (anchoDisponible - espacioEntreCajas) / 2;
    let y = doc.y;

    let totalGeneral = 0;
    for (let i = 0; i < estaciones.length; i += 2) {
      const izquierda = estaciones[i];
      const derecha = estaciones[i + 1];
      if (!izquierda) continue; // no debería pasar (el loop nunca arranca en un índice vacío), guarda solo para TS

      y = asegurarEspacio(doc, y, ALTO_FILA * 3);
      const yFinIzquierda = dibujarTablaProductos(doc, x, y, anchoCaja, izquierda.reporte.estacionCodigo, izquierda.reporte.productos);
      totalGeneral += izquierda.reporte.total;

      let yFinDerecha = y;
      if (derecha) {
        yFinDerecha = dibujarTablaProductos(doc, x + anchoCaja + espacioEntreCajas, y, anchoCaja, derecha.reporte.estacionCodigo, derecha.reporte.productos);
        totalGeneral += derecha.reporte.total;
      }
      y = Math.max(yFinIzquierda, yFinDerecha) + 20;
    }

    doc.y = y;
    doc.moveDown(0.3);
    doc.fillColor('#000000').fontSize(13).font('Helvetica-Bold').text(`Total todas las estaciones: ${formatearMonto(totalGeneral)}`, { underline: true });
    doc.font('Helvetica');
  }

  private renderizarEstacion(doc: PDFKit.PDFDocument, estacion: ReporteDiaEstacionDocumentoDTO): void {
    const { reporte, turnos } = estacion;
    const x = doc.page.margins.left;
    const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(18).fillColor('#000000').font('Helvetica-Bold').text(`Reporte del día -- ${reporte.estacionCodigo}`, { underline: true });
    doc.font('Helvetica');
    doc.moveDown(0.3);
    doc.fontSize(11).text(`Fecha de negocio: ${reporte.fechaNegocio}`);
    doc.moveDown();

    // --- Desglose por turno (v1.62), ahora con tabla estilo v1.63 -------
    doc.fontSize(14).text('Detalle por turno', { underline: true });
    doc.moveDown(0.3);
    let y = doc.y;

    if (turnos.length === 0) {
      doc.fontSize(10).text('(no se registraron cierres de turno individuales para este día -- el cierre de día se recibió sin turnos asociados)');
      doc.moveDown();
      y = doc.y;
    } else {
      for (const turno of turnos) {
        const subtitulo = `Inicio: ${turno.fechaInicio}   Fin: ${turno.fecha}`;
        y = dibujarTablaProductos(doc, x, y, ancho, `${ETIQUETA_TURNO[turno.turno]} -- ${turno.empleado}`, turno.productos, subtitulo);
        y = asegurarEspacio(doc, y, 14);
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9).text(`Total del turno: ${formatearMonto(turno.total)}`, x, y + 2, { width: ancho, align: 'right' });
        doc.font('Helvetica');
        y += 18;
      }
    }

    // --- Resumen del día completo (mismos totales que ya mostraba el PDF
    // desde v1.60/v1.62 -- fuente de verdad `cierres_dia`, nunca
    // recalculada del detalle) -- ahora también como tabla estilo v1.63.
    doc.y = y;
    doc.moveDown(0.4);
    doc.fontSize(14).text('Resumen del día', { underline: true });
    doc.moveDown(0.3);
    y = doc.y;
    y = dibujarTablaProductos(doc, x, y, ancho, `Resumen del día -- ${reporte.estacionCodigo}`, reporte.productos);

    doc.y = y;
    doc.moveDown(0.4);
    doc.fontSize(11).font('Helvetica-Bold').text(`Total del día: ${formatearMonto(reporte.total)}`);
    doc.font('Helvetica');
    doc.text(`Combustible: ${formatearMonto(reporte.totalCombustible)}`);
    doc.text(`No combustible: ${formatearMonto(reporte.totalNoCombustible)}`);
    if (reporte.totalSinClasificar > 0) {
      doc.text(`Sin clasificar: ${formatearMonto(reporte.totalSinClasificar)}`);
    }
    doc.moveDown();
  }
}
