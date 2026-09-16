// GenerarReporteDiaDocumento.test.ts (v1.78)
//
// Mismo criterio de fakes en memoria que ObtenerReporteDia.test.ts /
// ObtenerReporteDiaDocumento.test.ts -- sin AWS real.

import { GenerarReporteDiaDocumento } from './GenerarReporteDiaDocumento';
import type { FiltrosReporteDia, ReporteDiaDTO, ReporteDiaQueryRepository, ReporteDiaTurnoDTO } from '../ports/ReporteDiaQueryRepository';
import type { DocumentoStoragePort, ReporteDiaDocumentoDatos, ReporteDiaRendererPort } from '../ports/ReporteDiaDocumentoPorts';

function cierreDiaIdDe(estacionCodigo: string): string {
  return `cierre-dia-${estacionCodigo}`;
}

function reporteDe(estacionCodigo: string): ReporteDiaDTO {
  return {
    estacionCodigo,
    fechaNegocio: '2026-09-16',
    cierreDiaId: cierreDiaIdDe(estacionCodigo),
    total: 1000,
    totalCombustible: 900,
    totalNoCombustible: 100,
    totalSinClasificar: 0,
    productos: [],
  };
}

function turnosDe(estacionCodigo: string): ReporteDiaTurnoDTO[] {
  return [
    {
      cierreTurnoId: `${estacionCodigo}-t1`,
      turno: 'TURNO1',
      empleado: 'Juan Pérez',
      fechaInicio: '2026-09-16T06:00:00.000Z',
      fecha: '2026-09-16T14:00:00.000Z',
      total: 400,
      productos: [],
    },
  ];
}

class RepoFake implements ReporteDiaQueryRepository {
  public llamoListarActivas = false;
  constructor(
    private readonly reportesPorEstacion: Record<string, ReporteDiaDTO | null>,
    private readonly codigosActivos: string[] = []
  ) {}

  async obtener(filtros: FiltrosReporteDia): Promise<ReporteDiaDTO | null> {
    return this.reportesPorEstacion[filtros.estacionCodigo] ?? null;
  }

  async listarCodigosEstacionesActivas(): Promise<string[]> {
    this.llamoListarActivas = true;
    return this.codigosActivos;
  }

  async listarTurnos(cierreDiaId: string): Promise<ReporteDiaTurnoDTO[]> {
    const estacionCodigo = cierreDiaId.replace(/^cierre-dia-/, '');
    return turnosDe(estacionCodigo);
  }
}

class RendererFake implements ReporteDiaRendererPort {
  public llamadas: ReporteDiaDocumentoDatos[] = [];
  async renderizarPdf(datos: ReporteDiaDocumentoDatos): Promise<Buffer> {
    this.llamadas.push(datos);
    return Buffer.from('pdf-fake');
  }
}

class StorageFake implements DocumentoStoragePort {
  public subidas: { key: string; contentType: string }[] = [];
  async subir(params: { buffer: Buffer; key: string; contentType: string }): Promise<void> {
    this.subidas.push({ key: params.key, contentType: params.contentType });
  }
  async obtenerUrlFirmada(): Promise<never> {
    throw new Error('no usado en este caso de uso');
  }
}

describe('GenerarReporteDiaDocumento', () => {
  it('genera y sube el PDF individual de la estación con la key estable {ESTACION}-{fecha}.pdf', async () => {
    const repo = new RepoFake({ CHANCAYLLO: reporteDe('CHANCAYLLO') }, ['CHANCAYLLO']);
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new GenerarReporteDiaDocumento(repo, renderer, storage);

    await caso.ejecutar({ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-09-16' });

    expect(storage.subidas).toContainEqual({ key: 'reportes-dia/CHANCAYLLO-20260916.pdf', contentType: 'application/pdf' });
    expect(renderer.llamadas[0]).toEqual({
      modo: 'individual',
      estacion: { reporte: reporteDe('CHANCAYLLO'), turnos: turnosDe('CHANCAYLLO') },
    });
  });

  it('regenera el CONSOLIDADO incluyendo todas las estaciones activas que ya tengan cierre ese día', async () => {
    const repo = new RepoFake(
      { CHANCAYLLO: reporteDe('CHANCAYLLO'), MALA: reporteDe('MALA'), ANDAHUASI: null },
      ['ANDAHUASI', 'CHANCAYLLO', 'MALA']
    );
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new GenerarReporteDiaDocumento(repo, renderer, storage);

    // Llega el cierre de MALA -- el consolidado igual debe incluir a
    // CHANCAYLLO (que ya había cerrado antes) y omitir a ANDAHUASI (sin
    // cierre todavía), con una key fija que no depende de qué estación
    // disparó la regeneración.
    await caso.ejecutar({ estacionCodigo: 'MALA', fechaNegocio: '2026-09-16' });

    expect(repo.llamoListarActivas).toBe(true);
    expect(storage.subidas).toContainEqual({ key: 'reportes-dia/CONSOLIDADO-20260916.pdf', contentType: 'application/pdf' });
    const consolidado = renderer.llamadas.find((d) => d.modo === 'consolidado');
    expect(consolidado).toEqual({
      modo: 'consolidado',
      fechaNegocio: '2026-09-16',
      estaciones: [
        { reporte: reporteDe('CHANCAYLLO'), turnos: turnosDe('CHANCAYLLO') },
        { reporte: reporteDe('MALA'), turnos: turnosDe('MALA') },
      ],
    });
  });

  it('no sube nada si, por una condición de carrera, el cierre recién publicado no aparece todavía en el repo', async () => {
    const repo = new RepoFake({}, []);
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new GenerarReporteDiaDocumento(repo, renderer, storage);

    await caso.ejecutar({ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-09-16' });

    expect(storage.subidas.find((s) => s.key.includes('CHANCAYLLO'))).toBeUndefined();
  });

  it('no sube el consolidado si ninguna estación activa tiene cierre ese día', async () => {
    const repo = new RepoFake({}, ['CHANCAYLLO']);
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new GenerarReporteDiaDocumento(repo, renderer, storage);

    await caso.ejecutar({ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-09-16' });

    expect(storage.subidas.find((s) => s.key.includes('CONSOLIDADO'))).toBeUndefined();
  });
});
