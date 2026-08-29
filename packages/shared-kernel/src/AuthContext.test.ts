// AuthContext.test.ts — `npm run test:unit` (sección 7/12.6, v1.50).
//
// Cubre las 3 funciones de autorización por estación (5.4) más el parseo del
// evento de API Gateway — las 4 sin ningún import de AWS, tal como promete
// la sección 7 ("Jest sin mocks de AWS").

import { estacionesPermitidasDelToken, estacionUnicaDelToken, hasAccessToStation, parseAuthContext, type AuthContext } from './AuthContext';

function authCon(stationScope: string): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope, scopes: [] };
}

describe('hasAccessToStation', () => {
  it('permite cualquier estación cuando el scope es el wildcard "*"', () => {
    expect(hasAccessToStation(authCon('*'), 'CHANCAYLLO')).toBe(true);
    expect(hasAccessToStation(authCon('*'), 'CUALQUIERA')).toBe(true);
  });

  it('permite solo el código exacto cuando el token tiene una sola estación', () => {
    const auth = authCon('CHANCAYLLO');
    expect(hasAccessToStation(auth, 'CHANCAYLLO')).toBe(true);
    expect(hasAccessToStation(auth, 'MALA')).toBe(false);
  });

  it('permite cualquiera de los códigos de una lista separada por comas, ignorando espacios', () => {
    const auth = authCon('CHANCAYLLO, MALA ,ANDAHUASI');
    expect(hasAccessToStation(auth, 'MALA')).toBe(true);
    expect(hasAccessToStation(auth, 'ANDAHUASI')).toBe(true);
    expect(hasAccessToStation(auth, 'PACHACUTEC')).toBe(false);
  });

  it('no da acceso a nada con un scope vacío', () => {
    expect(hasAccessToStation(authCon(''), 'CHANCAYLLO')).toBe(false);
  });
});

describe('estacionUnicaDelToken', () => {
  it('devuelve el código cuando el token tiene exactamente una estación', () => {
    expect(estacionUnicaDelToken(authCon('CHANCAYLLO'))).toBe('CHANCAYLLO');
  });

  it('devuelve undefined con el wildcard', () => {
    expect(estacionUnicaDelToken(authCon('*'))).toBeUndefined();
  });

  it('devuelve undefined cuando hay varias estaciones (caso integrador multi-estación)', () => {
    expect(estacionUnicaDelToken(authCon('CHANCAYLLO,MALA'))).toBeUndefined();
  });
});

describe('estacionesPermitidasDelToken', () => {
  it('devuelve el literal "*" sin parsear cuando el scope es wildcard', () => {
    expect(estacionesPermitidasDelToken(authCon('*'))).toBe('*');
  });

  it('devuelve el array de códigos, sin espacios ni vacíos, para una lista', () => {
    expect(estacionesPermitidasDelToken(authCon('CHANCAYLLO, MALA ,'))).toEqual(['CHANCAYLLO', 'MALA']);
  });

  it('devuelve un array de un solo elemento para una sola estación', () => {
    expect(estacionesPermitidasDelToken(authCon('CHANCAYLLO'))).toEqual(['CHANCAYLLO']);
  });
});

describe('parseAuthContext', () => {
  it('lee los 4 campos desde requestContext.authorizer.claims (sección 5.1)', () => {
    const auth = parseAuthContext({
      requestContext: {
        authorizer: {
          claims: {
            client_id: '4abc123',
            'custom:role': 'SISTEMA_GRIFO',
            'custom:station_scope': 'CHANCAYLLO',
            scope: 'fuelhub-api/cierres.write fuelhub-api/cierres.read',
          },
        },
      },
    });
    expect(auth).toEqual({
      clientId: '4abc123',
      role: 'SISTEMA_GRIFO',
      stationScope: 'CHANCAYLLO',
      scopes: ['fuelhub-api/cierres.write', 'fuelhub-api/cierres.read'],
    });
  });

  it('cae en valores vacíos/por defecto sin lanzar si el evento no trae claims', () => {
    expect(parseAuthContext({})).toEqual({ clientId: '', role: '', stationScope: '', scopes: [] });
  });

  it('usa "sub" como clientId de respaldo si no viene client_id (sección 9.2.2: hoy siempre viene client_id en M2M, pero no se asume)', () => {
    const auth = parseAuthContext({
      requestContext: { authorizer: { claims: { sub: 'abc-sub', scope: '' } } },
    });
    expect(auth.clientId).toBe('abc-sub');
  });
});
