// DocumentoReporteKey.test.ts (v1.78, formato reescrito v1.85)

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { construirKeyDocumentoConsolidado, construirKeyDocumentoEstacion, construirKeyDocumentoTurno } from './DocumentoReporteKey';

describe('DocumentoReporteKey', () => {
  it('construye la key de una estación con el formato legible pedido por notificaciones-whatsapp (v1.85)', () => {
    expect(construirKeyDocumentoEstacion('CHANCAYLLO', '2026-09-16')).toBe('reportes-dia/cierre_dia_CHANCAYLLO_2026-09-16.pdf');
  });

  it('construye la key del consolidado con el mismo formato', () => {
    expect(construirKeyDocumentoConsolidado('2026-09-16')).toBe('reportes-dia/cierre_dia_consolidado_2026-09-16.pdf');
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

  it('construye la key de un turno con el sufijo T1/T2/T3 (v1.85)', () => {
    expect(construirKeyDocumentoTurno('PACHACUTEC', '2026-09-15', 'TURNO1')).toBe('reportes-dia/cierre_turno_PACHACUTEC_2026-09-15_T1.pdf');
    expect(construirKeyDocumentoTurno('PACHACUTEC', '2026-09-15', 'TURNO2')).toBe('reportes-dia/cierre_turno_PACHACUTEC_2026-09-15_T2.pdf');
    expect(construirKeyDocumentoTurno('PACHACUTEC', '2026-09-15', 'TURNO3')).toBe('reportes-dia/cierre_turno_PACHACUTEC_2026-09-15_T3.pdf');
  });

  it('rechaza fechaNegocio con formato inválido en la key de turno', () => {
    expect(() => construirKeyDocumentoTurno('PACHACUTEC', '15/09/2026', 'TURNO1')).toThrow(ParametrosInvalidosError);
  });
});
