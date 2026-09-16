// DocumentoReporteKey.test.ts (v1.78)

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { construirKeyDocumentoConsolidado, construirKeyDocumentoEstacion } from './DocumentoReporteKey';

describe('DocumentoReporteKey', () => {
  it('construye la key aplanada de una estación, fecha compacta sin guiones', () => {
    expect(construirKeyDocumentoEstacion('CHANCAYLLO', '2026-09-16')).toBe('reportes-dia/CHANCAYLLO-20260916.pdf');
  });

  it('construye la key del consolidado con el mismo formato de fecha', () => {
    expect(construirKeyDocumentoConsolidado('2026-09-16')).toBe('reportes-dia/CONSOLIDADO-20260916.pdf');
  });

  it('es determinística -- misma estación/fecha siempre produce la misma key', () => {
    const a = construirKeyDocumentoEstacion('MALA', '2026-01-05');
    const b = construirKeyDocumentoEstacion('MALA', '2026-01-05');
    expect(a).toBe(b);
  });

  it('rechaza fechaNegocio con formato inválido', () => {
    expect(() => construirKeyDocumentoEstacion('CHANCAYLLO', '16-09-2026')).toThrow(ParametrosInvalidosError);
    expect(() => construirKeyDocumentoConsolidado('2026/09/16')).toThrow(ParametrosInvalidosError);
  });
});
