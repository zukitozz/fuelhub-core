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

export interface MensajeFacturaProveedor {
  readonly mensajeId: string;
  readonly xmlContenido: string;
}

export interface FacturaProveedorSourcePort {
  /** Mensajes con la etiqueta de origen que todavía no tienen ni la de procesado ni la de error. */
  listarMensajesPendientes(): Promise<readonly MensajeFacturaProveedor[]>;
  marcarProcesado(mensajeId: string): Promise<void>;
  marcarError(mensajeId: string): Promise<void>;
}
