-- 1787936588637_seed-productos-maestro.sql
--
-- Carga inicial de `productos_maestro` (sección 3.8.1) — catálogo único y
-- global de combustibles, sin mantenimiento recurrente. Los 5 UUID están
-- confirmados como FINALES (changelog v1.19): no se regeneran, se publican
-- tal cual en la guía de integración para los desarrolladores de cada
-- estación. Corre una sola vez, como parte del despliegue inicial (12.4) —
-- antes de cualquier migración que dependa de estos IDs (p. ej. el seed de
-- tanques, que referencia `producto_id`).

-- Up Migration

INSERT INTO productos_maestro (id, alias, nombre, medida) VALUES
    ('f7ec806f-0e5c-4949-8110-b48469fd3ecf', 'db50', 'Diésel',  'GAL'),
    ('b6e71805-30e1-4bec-875f-bf8e1d307972', NULL,   'Premium', 'GAL'),
    ('e032f8dc-af1e-44a2-851d-e0e6be27a223', NULL,   'Regular', 'GAL'),
    ('56742282-f480-4f38-b0b5-3d88c1282228', NULL,   'GLP',     'LT'),
    ('16b03568-77d1-4c5c-95f9-9e733bc38787', NULL,   'GNV',     'LT');

-- Down Migration

DELETE FROM productos_maestro WHERE id IN (
    'f7ec806f-0e5c-4949-8110-b48469fd3ecf',
    'b6e71805-30e1-4bec-875f-bf8e1d307972',
    'e032f8dc-af1e-44a2-851d-e0e6be27a223',
    '56742282-f480-4f38-b0b5-3d88c1282228',
    '16b03568-77d1-4c5c-95f9-9e733bc38787'
);
