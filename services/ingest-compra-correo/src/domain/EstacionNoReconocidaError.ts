// domain/EstacionNoReconocidaError.ts
//
// El caso de uso (`ProcesarFacturaProveedorCorreo`) la lanza cuando el RUC
// receptor del XML (`AccountingCustomerParty`) no matchea ninguna estación
// activa del grupo (`estaciones.ruc`). No puede registrar nada en ese caso
// -- `compras.estacion_id` es NOT NULL, no existe un valor "desconocido" --
// así que esto se trata como falla de procesamiento del correo completo
// (todas sus líneas), igual que un XML corrupto (`FacturaXmlInvalidaError`):
// el adaptador de Gmail le pone la etiqueta de error para que Jorge lo
// revise a mano, en vez de intentar adivinar la estación.

export class EstacionNoReconocidaError extends Error {
  constructor(rucReceptor: string) {
    super(`Ninguna estación activa tiene el RUC receptor de la factura: ${rucReceptor}`);
    this.name = 'EstacionNoReconocidaError';
  }
}
