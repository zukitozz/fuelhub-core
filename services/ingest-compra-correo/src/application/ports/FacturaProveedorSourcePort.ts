// application/ports/FacturaProveedorSourcePort.ts
//
// Puerto hacia "de dónde vienen las facturas" -- separado a propósito de
// `CompraCorreoRepository` (persistencia). Hoy el único adaptador real es
// Gmail (`GmailFacturaProveedorSource`, infrastructure/adapters/), pero
// Jorge ya avisó que a futuro piensa migrar a Amazon SES (recepción de
// correo entrante + Lambda disparado por SES en vez de sondear Gmail por
// cron) -- con este puerto, ese día solo hace falta un adaptador nuevo,
// nada de `handler.ts` ni de `ProcesarFacturaProveedorCorreo` cambia.
//
// `listarMensajesPendientes` ya devuelve el XML descargado (no solo el id)
// -- el composition root (`handler.ts`) no necesita saber nada de cómo se
// bajó el adjunto, sea de Gmail, S3 (destino típico de SES) o lo que sea.
//
// `marcarProcesado`/`marcarError` son la mitad "eficiencia" del dedup de
// dos capas (ver nota de cabecera de la migración 1788600000000): evitan
// releer el mismo mensaje en la próxima corrida del cron. La garantía real
// contra duplicados es el índice único de `compras` -- si estas etiquetas
// se desincronizaran por lo que sea, `existeComprobante`/el índice único
// igual protegen a la base.
//
// `xmlContenidos` (plural, v1.83) -- hallazgo real de Jorge: un correo de
// proveedor puede traer VARIAS facturas en un solo mensaje (varios adjuntos
// `.xml`, uno por factura, cada uno típicamente acompañado de su PDF). Hasta
// v1.82 este campo era `xmlContenido` (singular) y `GmailFacturaProveedorSource`
// solo bajaba el PRIMER `.xml` que encontraba -- un correo con 10 facturas
// procesaba 1 y perdía las otras 9 en silencio (el mensaje quedaba marcado
// `FuelHub/Procesado`, nunca se reintentaba). Un mensaje sin NINGÚN adjunto
// `.xml` sigue sin entrar en la lista (se marca error directo, ver el
// adaptador) -- la lista nunca viene vacía para un mensaje incluido acá.

export interface MensajeFacturaProveedor {
  readonly mensajeId: string;
  readonly xmlContenidos: readonly string[];
}

export interface FacturaProveedorSourcePort {
  /** Mensajes con la etiqueta de origen que todavía no tienen ni la de procesado ni la de error. */
  listarMensajesPendientes(): Promise<readonly MensajeFacturaProveedor[]>;
  marcarProcesado(mensajeId: string): Promise<void>;
  marcarError(mensajeId: string): Promise<void>;
}
