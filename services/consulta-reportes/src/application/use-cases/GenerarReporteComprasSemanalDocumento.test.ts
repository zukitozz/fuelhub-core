// GenerarReporteComprasSemanalDocumento.test.ts (v1.86)
//
// Mismo criterio de fakes en memoria que GenerarReporteTurnoDocumento.test.ts.

import { GenerarReporteComprasSemanalDocumento } from './GenerarReporteComprasSemanalDocumento';
import type {
  EstacionActivaDTO,
  ReporteComprasSemanalItemDTO,
  ReporteComprasSemanalQueryRepository,
} from '../ports/ReporteComprasSemanalQueryRepository';
import type { ReporteComprasSemanalRendererPort } from '../ports/ReporteComprasSemanalDocumentoPorts';
import type { DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';
import type { EventPublisherPort, ReporteComprasSemanalRegistradoEvent } from '../ports/EventPublisherPort';

class RepoFake implements ReporteComprasSemanalQueryRepository {
  public estaciones: EstacionActivaDTO[] = [];
  public volumenesPorEstacion: Record<string, ReporteComprasSemanalItemDTO[]> = {};
  public llamadasObtenerVolumenes: { estacionCodigo: string; fechaInicio: string; fechaFin: string }[] = [];

  async obtenerVolumenesPorProducto(estacionCodigo: string, fechaInicio: string, fechaFin: string): Promise<readonly ReporteComprasSemanalItemDTO[]> {
    this.llamadasObtenerVolumenes.push({ estacionCodigo, fechaInicio, fechaFin });
    return this.volumenesPorEstacion[estacionCodigo] ?? [];
  }

  async listarEstacionesActivas(): Promise<readonly EstacionActivaDTO[]> {
    return this.estaciones;
  }
}

class RendererFake implements ReporteComprasSemanalRendererPort {
  public llamadas: { estacionCodigo: string; fechaInicio: string; fechaFin: string; items: readonly ReporteComprasSemanalItemDTO[] }[] = [];
  fallarEn: string | null = null;

  async renderizarExcel(params: {
    estacionCodigo: string;
    fechaInicio: string;
    fechaFin: string;
    items: readonly ReporteComprasSemanalItemDTO[];
  }): Promise<Buffer> {
    if (params.estacionCodigo === this.fallarEn) {
      throw new Error('fallo simulado de renderizado');
    }
    this.llamadas.push(params);
    return Buffer.from('excel-fake');
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

class EventosFake implements EventPublisherPort {
  public publicados: ReporteComprasSemanalRegistradoEvent[] = [];
  fallarSiempre = false;

  async publicarReporteComprasSemanalRegistrado(evento: ReporteComprasSemanalRegistradoEvent): Promise<void> {
    if (this.fallarSiempre) {
      throw new Error('fallo simulado de EventBridge');
    }
    this.publicados.push(evento);
  }
}

describe('GenerarReporteComprasSemanalDocumento', () => {
  it('genera, sube y publica el evento para cada estación activa, con fechaFin = fechaInicio + 6 días', async () => {
    const repo = new RepoFake();
    repo.estaciones = [{ id: 'id-chancayllo', codigo: 'CHANCAYLLO' }];
    repo.volumenesPorEstacion.CHANCAYLLO = [{ producto: 'Diésel', volumen: 5000 }];
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const eventos = new EventosFake();
    const caso = new GenerarReporteComprasSemanalDocumento(repo, renderer, storage, eventos);

    await caso.ejecutar('2026-10-05');

    expect(repo.llamadasObtenerVolumenes).toEqual([{ estacionCodigo: 'CHANCAYLLO', fechaInicio: '2026-10-05', fechaFin: '2026-10-11' }]);
    expect(renderer.llamadas).toHaveLength(1);
    expect(storage.subidas).toContainEqual({
      key: 'reportes-semanal/reporte_compras_semanal_CHANCAYLLO_2026-10-05_2026-10-11.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(eventos.publicados).toEqual([
      {
        proyectoCodigo: 'FUELHUBCLOUD',
        estacionId: 'id-chancayllo',
        estacionCodigo: 'CHANCAYLLO',
        fechaInicio: '2026-10-05',
        fechaFin: '2026-10-11',
        tipo: 'reporte semanal de compras',
        reporteSemanalId: 'id-chancayllo-2026-10-05',
      },
    ]);
  });

  it('genera y publica igual una semana sin compras de combustible -- Excel en cero, no se omite', async () => {
    const repo = new RepoFake();
    repo.estaciones = [{ id: 'id-mala', codigo: 'MALA' }];
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const eventos = new EventosFake();
    const caso = new GenerarReporteComprasSemanalDocumento(repo, renderer, storage, eventos);

    await caso.ejecutar('2026-10-05');

    expect(renderer.llamadas).toEqual([{ estacionCodigo: 'MALA', fechaInicio: '2026-10-05', fechaFin: '2026-10-11', items: [] }]);
    expect(storage.subidas).toHaveLength(1);
    expect(eventos.publicados).toHaveLength(1);
  });

  it('una estación que falla no tumba el reporte de las demás', async () => {
    const repo = new RepoFake();
    repo.estaciones = [
      { id: 'id-andahuasi', codigo: 'ANDAHUASI' },
      { id: 'id-pachacutec', codigo: 'PACHACUTEC' },
    ];
    const renderer = new RendererFake();
    renderer.fallarEn = 'ANDAHUASI';
    const storage = new StorageFake();
    const eventos = new EventosFake();
    const caso = new GenerarReporteComprasSemanalDocumento(repo, renderer, storage, eventos);

    await caso.ejecutar('2026-10-05');

    expect(storage.subidas).toHaveLength(1);
    expect(storage.subidas[0]?.key).toContain('PACHACUTEC');
    expect(eventos.publicados).toHaveLength(1);
    expect(eventos.publicados[0]?.estacionCodigo).toBe('PACHACUTEC');
  });

  it('si EventBridge falla, el Excel ya subido a S3 no se revierte -- best effort', async () => {
    const repo = new RepoFake();
    repo.estaciones = [{ id: 'id-chancayllo', codigo: 'CHANCAYLLO' }];
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const eventos = new EventosFake();
    eventos.fallarSiempre = true;
    const caso = new GenerarReporteComprasSemanalDocumento(repo, renderer, storage, eventos);

    await caso.ejecutar('2026-10-05');

    expect(storage.subidas).toHaveLength(1);
    expect(eventos.publicados).toHaveLength(0);
  });
});
