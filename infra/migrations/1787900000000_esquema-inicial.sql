-- 1787900000000_esquema-inicial.sql
--
-- Crea el esquema completo de la sección 3.3 — las 9 tablas + los 2 tipos
-- ENUM + los índices, tal cual el DDL publicado en la spec. Es la migración
-- que faltaba desde v1.40/v1.47 (12.6): hasta ahora el DDL solo vivía en el
-- documento, y `infra/migrations/` únicamente tenía los 2 seeds
-- (`productos_maestro`, `tanques`) — que asumen que estas tablas ya existen.
--
-- ORDEN: esta migración corre PRIMERO, antes de los 2 seeds — su timestamp
-- (1787900000000) es menor que el de ambos (1787936588637/638), así que
-- `node-pg-migrate` ya la ordena así solo. No cambia el contenido de los
-- seeds existentes.
--
-- Contenido, columna por columna, idéntico al DDL de 3.3 — no es una
-- reinterpretación, es el mismo bloque SQL que ya estaba confirmado y
-- versionado en el documento (incluye el `correo` nullable de v1.47).
--
-- VALIDADO de punta a punta contra un Postgres 16 real, con `node-pg-migrate`
-- de verdad (no `psql -f` a mano, a diferencia de la validación de v1.43):
-- se corrió `up` (crea las 9 tablas + 2 tipos + 9 índices), encima los 2
-- seeds ya existentes (confirma que este esquema es compatible con ellos
-- sin ajustes), después `down` (esquema queda vacío) y `up` otra vez
-- (confirma que no queda ningún objeto residual del primer `down` que
-- rompa una segunda corrida) — ver changelog v1.49/v1.50.

-- Up Migration

CREATE TYPE estado_cierre AS ENUM ('ACTIVO', 'ANULADO');
CREATE TYPE turno_enum    AS ENUM ('TURNO1', 'TURNO2', 'TURNO3');

CREATE TABLE estaciones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          VARCHAR(20) NOT NULL UNIQUE,
    nombre          VARCHAR(120) NOT NULL,
    ruc             VARCHAR(11),
    emisor_id_legacy INTEGER UNIQUE,
    zona_horaria    VARCHAR(50) NOT NULL DEFAULT 'America/Lima',
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estacion_id           UUID REFERENCES estaciones(id),
    usuario               VARCHAR(255) NOT NULL UNIQUE,
    nombre                VARCHAR(255) NOT NULL,
    correo                VARCHAR(255),
    rol                   VARCHAR(30) NOT NULL DEFAULT 'OPERADOR',
    activo                BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE productos_maestro (
    id         UUID PRIMARY KEY,
    alias      VARCHAR(20) UNIQUE,
    nombre     VARCHAR(120) NOT NULL,
    medida     VARCHAR(20) NOT NULL,
    activo     BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cierres_dia (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estacion_id             UUID NOT NULL REFERENCES estaciones(id),
    usuario_id              UUID NOT NULL REFERENCES usuarios(id),
    isla                    VARCHAR(50),
    fecha_negocio           DATE NOT NULL,
    fecha                   TIMESTAMPTZ NOT NULL,
    total                   NUMERIC(14,2) NOT NULL,
    estado                  estado_cierre NOT NULL DEFAULT 'ACTIVO',
    contador_impresiones    INT NOT NULL DEFAULT 0,
    clave_idempotencia      VARCHAR(80) UNIQUE,
    cliente_origen          VARCHAR(100) NOT NULL,
    recibido_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload_original        JSONB,
    creado_en                TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cierres_turno (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cierre_dia_id           UUID REFERENCES cierres_dia(id) ON DELETE SET NULL,
    estacion_id             UUID NOT NULL REFERENCES estaciones(id),
    isla                    VARCHAR(255),
    turno                   turno_enum NOT NULL,
    fecha_negocio           DATE NOT NULL,
    fecha_inicio            TIMESTAMPTZ NOT NULL,
    fecha                    TIMESTAMPTZ NOT NULL,
    total                     NUMERIC(14,2) NOT NULL,
    estado                     estado_cierre NOT NULL DEFAULT 'ACTIVO',
    contador_impresiones        INT NOT NULL DEFAULT 0,
    usuario_id                   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    facturas_emitidas             INT NOT NULL DEFAULT 0,
    clave_idempotencia             VARCHAR(80) UNIQUE,
    cliente_origen                  VARCHAR(100) NOT NULL,
    recibido_en                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload_original                  JSONB,
    creado_en                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (fecha > fecha_inicio)
);

CREATE INDEX ix_cierres_turno_dia            ON cierres_turno (cierre_dia_id);
CREATE INDEX ix_cierres_turno_estacion_fecha ON cierres_turno (estacion_id, fecha_negocio);
CREATE INDEX ix_cierres_turno_usuario        ON cierres_turno (usuario_id, fecha_negocio);
CREATE INDEX ix_cierres_dia_estacion         ON cierres_dia (estacion_id, fecha_negocio);
CREATE INDEX ix_cierres_dia_usuario          ON cierres_dia (usuario_id, fecha_negocio);

CREATE TABLE cierres_turno_pagos (
    id                BIGSERIAL PRIMARY KEY,
    cierre_turno_id   UUID NOT NULL REFERENCES cierres_turno(id) ON DELETE CASCADE,
    medio_pago        VARCHAR(30) NOT NULL,
    monto             NUMERIC(14,2) NOT NULL
);

CREATE TABLE cierres_turno_detalle (
    id                     BIGSERIAL PRIMARY KEY,
    cierre_turno_id        UUID NOT NULL REFERENCES cierres_turno(id) ON DELETE CASCADE,
    producto_id            UUID REFERENCES productos_maestro(id),
    producto_codigo_local  VARCHAR(255),
    producto_nombre        VARCHAR(255) NOT NULL,
    medida                 VARCHAR(255),
    total_cantidad         NUMERIC(12,3),
    total_soles            NUMERIC(12,2),
    calibracion_cantidad   NUMERIC(12,3),
    calibracion_soles      NUMERIC(12,2),
    despacho_cantidad      NUMERIC(12,3),
    despacho_soles         NUMERIC(12,2)
);

CREATE INDEX ix_cierres_turno_detalle_turno    ON cierres_turno_detalle (cierre_turno_id);
CREATE INDEX ix_cierres_turno_detalle_producto ON cierres_turno_detalle (producto_id);

CREATE TABLE tanques (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estacion_id       UUID NOT NULL REFERENCES estaciones(id),
    producto_id       UUID NOT NULL REFERENCES productos_maestro(id),
    nombre            VARCHAR(50) NOT NULL,
    capacidad         NUMERIC(12,2) NOT NULL,
    stock_minimo      NUMERIC(12,2),
    producto_asignado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    activo            BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (estacion_id, nombre)
);

CREATE TABLE compras (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estacion_id         UUID NOT NULL REFERENCES estaciones(id),
    tanque_id           UUID REFERENCES tanques(id),
    producto_id         UUID NOT NULL REFERENCES productos_maestro(id),
    proveedor           VARCHAR(150),
    fecha               TIMESTAMPTZ NOT NULL,
    cantidad            NUMERIC(12,3) NOT NULL,
    costo_unitario      NUMERIC(10,3) NOT NULL,
    costo_total         NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * costo_unitario) STORED,
    numero_guia         VARCHAR(50),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_compras_estacion_fecha ON compras (estacion_id, fecha);
CREATE INDEX ix_compras_producto       ON compras (producto_id, fecha);

-- Down Migration

DROP TABLE IF EXISTS compras;
DROP TABLE IF EXISTS tanques;
DROP TABLE IF EXISTS cierres_turno_detalle;
DROP TABLE IF EXISTS cierres_turno_pagos;
DROP TABLE IF EXISTS cierres_turno;
DROP TABLE IF EXISTS cierres_dia;
DROP TABLE IF EXISTS productos_maestro;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS estaciones;
DROP TYPE IF EXISTS turno_enum;
DROP TYPE IF EXISTS estado_cierre;
