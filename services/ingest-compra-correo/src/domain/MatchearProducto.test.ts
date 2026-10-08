// MatchearProducto.test.ts

import { matchearProducto, type ProductoCatalogo } from './MatchearProducto';

// Mismo catálogo real de productos_maestro (migración 1787936588637_seed-productos-maestro.sql).
const CATALOGO: readonly ProductoCatalogo[] = [
  { id: 'id-diesel', nombre: 'Diésel', alias: 'db50', categoria: 'COMBUSTIBLE' },
  { id: 'id-premium', nombre: 'Premium', alias: null, categoria: 'COMBUSTIBLE' },
  { id: 'id-regular', nombre: 'Regular', alias: null, categoria: 'COMBUSTIBLE' },
  { id: 'id-glp', nombre: 'GLP', alias: null, categoria: 'COMBUSTIBLE' },
  { id: 'id-gnv', nombre: 'GNV', alias: null, categoria: 'COMBUSTIBLE' },
];

describe('matchearProducto', () => {
  it('matchea "DIESEL B5 S-50" contra Diésel', () => {
    expect(matchearProducto('DIESEL B5 S-50', CATALOGO)?.id).toBe('id-diesel');
  });

  it('matchea por el alias del catálogo ("db50")', () => {
    expect(matchearProducto('COMBUSTIBLE DB50 SEGUN GUIA', CATALOGO)?.id).toBe('id-diesel');
  });

  it('matchea "GASOHOL REGULAR 90" contra Regular', () => {
    expect(matchearProducto('GASOHOL REGULAR 90 OCTANOS', CATALOGO)?.id).toBe('id-regular');
  });

  it('matchea "GASOHOL PREMIUM 95" contra Premium', () => {
    expect(matchearProducto('GASOHOL PREMIUM 95 OCTANOS', CATALOGO)?.id).toBe('id-premium');
  });

  it('matchea "GAS LICUADO DE PETROLEO GLP" contra GLP', () => {
    expect(matchearProducto('GAS LICUADO DE PETROLEO GLP GRANEL', CATALOGO)?.id).toBe('id-glp');
  });

  it('matchea "GAS NATURAL VEHICULAR GNV" contra GNV', () => {
    expect(matchearProducto('GAS NATURAL VEHICULAR GNV', CATALOGO)?.id).toBe('id-gnv');
  });

  it('ignora tildes/mayúsculas al comparar', () => {
    expect(matchearProducto('diésel b5', CATALOGO)?.id).toBe('id-diesel');
  });

  it('no matchea ningún producto -- devuelve undefined (queda PENDIENTE_REVISION aguas arriba)', () => {
    expect(matchearProducto('GALLETAS SODA FIELD X 6 UND', CATALOGO)).toBeUndefined();
  });

  it('no matchea si la descripción calza con más de un producto a la vez y no es el caso diésel+gasolina -- devuelve undefined', () => {
    expect(matchearProducto('GLP Y PREMIUM MIXTO', CATALOGO)).toBeUndefined();
  });

  it('catálogo vacío -- nunca matchea', () => {
    expect(matchearProducto('DIESEL B5', [])).toBeUndefined();
  });

  // v1.85 -- hallazgo real de Jorge: su proveedor factura el diésel como
  // "DIESEL B5 S-50 UV PREMIUM", que matchea Diésel (keyword DIESEL/B5) Y
  // Premium (keyword PREMIUM literal) a la vez -- "PREMIUM" ahí es un
  // calificativo del diésel (aditivado/UV), no octanaje de gasolina.
  it('DIESEL gana cuando matchea junto con PREMIUM (grado comercial del diésel, no gasolina) -- caso real del proveedor', () => {
    expect(matchearProducto('DIESEL B5 S-50 UV PREMIUM', CATALOGO)?.id).toBe('id-diesel');
  });

  it('DIESEL gana cuando matchea junto con REGULAR, mismo criterio', () => {
    expect(matchearProducto('DIESEL B5 S-50 REGULAR', CATALOGO)?.id).toBe('id-diesel');
  });

  it('DIESEL gana cuando matchea junto con PREMIUM y REGULAR a la vez', () => {
    expect(matchearProducto('DIESEL B5 S-50 UV PREMIUM REGULAR', CATALOGO)?.id).toBe('id-diesel');
  });

  it('sigue ambiguo si DIESEL matchea junto con algo que NO sea PREMIUM/REGULAR (ej. GLP) -- no se fuerza un ganador', () => {
    expect(matchearProducto('DIESEL B5 Y GLP MIXTO', CATALOGO)).toBeUndefined();
  });
});
