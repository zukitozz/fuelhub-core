-- 1788500000000_usuario-unico-por-estacion.sql
--
-- Corrige la suposicion de la seccion 9.7 (v1.0 de la spec): se habia
-- confirmado con Jorge que un `usuarios.usuario` (codigo de
-- administrador/empleado) era conceptualmente unico EN TODO EL GRUPO -- si
-- una persona cambiaba de estacion se le daba de alta como usuario nuevo,
-- nunca se reutilizaba su codigo anterior en otra sede. Esa suposicion
-- resulto ser incorrecta: cada estacion es una empresa (E.I.R.L.) distinta
-- (ver 9.2.1), con su propio sistema legacy asignando codigos de forma
-- independiente -- es perfectamente normal que dos PERSONAS DISTINTAS en dos
-- estaciones distintas terminen con el mismo codigo por coincidencia, sin
-- que eso sea un caso de negocio invalido. Hallazgo real de Jorge:
-- `POST /cierres-dia` rechazando un cierre real con
-- "administrador.codigo ya esta registrado en otra estacion" para un codigo
-- que en realidad pertenece a dos administradores distintos de dos
-- estaciones distintas.
--
-- Cambio: el UNIQUE global sobre `usuario` pasa a ser un UNIQUE COMPUESTO
-- sobre (estacion_id, usuario) -- unico dentro de cada estacion, no en todo
-- el grupo. `usuarios.id` (UUID) sigue siendo la unica llave foranea real
-- que usan `cierres_turno`/`cierres_dia` (`usuario_id`), asi que este cambio
-- no afecta esas relaciones.
--
-- Efecto en el codigo de aplicacion (ver PostgresCierreDiaIngestaRepository.ts
-- y PostgresCierreTurnoIngestaRepository.ts): el UPSERT de auto-provisioning
-- pasa de `ON CONFLICT (usuario)` a `ON CONFLICT (estacion_id, usuario)` --
-- con el conflicto ya acotado a la propia estacion, el chequeo manual de
-- "otra estacion" (`WHERE usuarios.estacion_id = EXCLUDED.estacion_id` +
-- error explicito si no matchea ninguna fila) deja de tener sentido: un
-- conflicto entre estaciones distintas ya no puede ocurrir nunca. Se
-- simplifica ese codigo en el mismo cambio.
--
-- Efecto conocido y ACEPTADO (decision explicita de Jorge, sin agregar
-- validacion adicional): `GET /cierres-turno`/`GET /cierres-dia` tienen un
-- filtro opcional `usuarioCodigo` que, si el token que consulta tiene scope
-- wildcard (`station.*`, hoy solo `fuelhub-notificaciones-whatsapp`) y no
-- manda `estacionCodigo`, busca ese codigo en TODAS las estaciones a la vez
-- -- con este cambio, esa busqueda podria mezclar turnos de dos personas
-- distintas que compartan codigo en dos estaciones. No se agrega ninguna
-- validacion para evitarlo (a pedido explicito de Jorge) -- si en el futuro
-- esto genera un reporte incorrecto real, revisar esta nota antes que nada.
--
-- Sin filas duplicadas conocidas hoy dentro de una misma estacion (el UNIQUE
-- global previo ya lo garantizaba por transitividad -- si dos filas nunca
-- compartieron `usuario` en todo el grupo, tampoco lo comparten dentro de la
-- misma estacion), asi que el UNIQUE compuesto se puede agregar
-- directamente, sin backfill ni limpieza de datos previa.

-- Up Migration

ALTER TABLE usuarios
  DROP CONSTRAINT usuarios_usuario_key,
  ADD CONSTRAINT uq_usuarios_estacion_usuario UNIQUE (estacion_id, usuario);

-- Down Migration
--
-- Revertir a UNIQUE global falla si ya existen dos filas con el mismo
-- `usuario` en estaciones distintas creadas despues de este Up -- mismo
-- criterio que el resto del repo: el down asume que se corre antes de que
-- la funcionalidad nueva se use en produccion, no despues.

ALTER TABLE usuarios
  DROP CONSTRAINT uq_usuarios_estacion_usuario,
  ADD CONSTRAINT usuarios_usuario_key UNIQUE (usuario);
