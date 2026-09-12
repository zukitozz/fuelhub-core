# FuelHub Cloud API — curls de ejemplo para Postman

Basado en `openapi.yaml` (v1.66). Cada bloque es un `curl` que Postman importa
directo: **Import → Raw text**, pegas el curl, y Postman arma la request sola
(método, headers, body).

## Variables a reemplazar

En todos los curls de abajo vas a ver estos placeholders — reemplázalos antes
de correr (o, si usas el `.postman_collection.json` que te dejo al lado de
este archivo, ya están armados como variables de colección):

| Placeholder | Dónde conseguirlo |
|---|---|
| `$BASE_URL` | Ya confirmados (Salida `ApiUrl` de CloudFormation): dev = `https://i2o733ofzk.execute-api.us-east-2.amazonaws.com/dev/v1` — prod = `https://6gy2rrty17.execute-api.us-east-2.amazonaws.com/prod/v1`. Sin la barra final. |
| `$CLIENT_ID` / `$CLIENT_SECRET` | App Client de Cognito de la estación que quieras probar (User Pool `tczat3`, `us-east-2_nQ1gjcb0j`) — o el App Client de `SMOKE_TEST_CLIENT_ID`/`SMOKE_TEST_CLIENT_SECRET` que ya usa el pipeline si solo quieres probar sin usar una estación real. **Nunca pegues estos valores en un chat conmigo** — solo van en Postman/tu `.env` local. |
| `$TOKEN` | El `access_token` que devuelve el primer curl (Auth). |

El token endpoint (dominio Cognito) ya es fijo y no es secreto:
`https://us-east-2nq1gjcb0j.auth.us-east-2.amazoncognito.com/oauth2/token`

---

## 0. Auth — obtener token M2M (Client Credentials)

Pide los 3 scopes del App Client de la estación: `cierres.write`, `cierres.read`
y el scope exclusivo `station.<CODIGO>` (este último es el que el Pre Token
Generation Lambda usa para derivar `custom:station_scope`, sección 5.4 — sin
él, el token igual sirve pero puede quedar sin `custom:station_scope` resuelto
según cómo esté armado ese App Client). Ajusta `CHANCAYLLO` al código real de
la estación de tu client.

```bash
curl -X POST "https://us-east-2nq1gjcb0j.auth.us-east-2.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=fuelhub-api/cierres.write fuelhub-api/cierres.read fuelhub-api/station.CHANCAYLLO"
```

Respuesta esperada:
```json
{ "access_token": "eyJra...", "expires_in": 3600, "token_type": "Bearer" }
```

Copia `access_token` a `$TOKEN` para todo lo de abajo. Expira en 1 hora
(`expires_in`), después hay que repetir este curl.

---

## 1. POST /cierres-turno — registrar cierre de turno

Idempotente vía header `Idempotency-Key` (UUID v4 nuevo por cada intento
lógico — reenviar la misma key devuelve la respuesta cacheada del primer
intento, `200`, sin insertar de nuevo; en Postman usa la variable dinámica
`{{$guid}}` para que se genere sola en cada Send).

```bash
curl -X POST "$BASE_URL/cierres-turno" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: b3f1c2a4-6e8d-4a3b-9c1e-2f5a7d9b0c3e" \
  -d '{
    "codigoEstacion": "CHANCAYLLO",
    "isla": "ISLA-1",
    "turno": "TURNO1",
    "fechaNegocio": "2026-09-03",
    "fechaInicio": "2026-09-03T06:00:00-05:00",
    "fecha": "2026-09-03T14:05:00-05:00",
    "total": 4820.50,
    "facturasEmitidas": 12,
    "empleado": { "codigo": "EMP-014", "nombre": "Juan Pérez" },
    "pagos": [
      { "medio": "EFECTIVO", "monto": 1720.50 },
      { "medio": "TARJETA", "monto": 2100.00 },
      { "medio": "YAPE", "monto": 1000.00 }
    ],
    "detalle": [
      {
        "productoId": "e032f8dc-af1e-44a2-851d-e0e6be27a223",
        "codigoLocal": "GAS90",
        "producto": "Gasohol 90 (Regular)",
        "medida": "GAL",
        "totalCantidad": 420.500,
        "totalSoles": 3153.75,
        "despachoCantidad": 415.000,
        "despachoSoles": 3115.00,
        "calibracionCantidad": 5.500,
        "calibracionSoles": 38.75
      },
      {
        "codigoLocal": "BALON10",
        "producto": "Balón de gas 10kg",
        "medida": "UND",
        "totalCantidad": 15,
        "totalSoles": 1666.75,
        "categoria": "NO_COMBUSTIBLE"
      }
    ]
  }'
```

Nota: `productoId` de la línea de Gasohol 90 es el UUID de ejemplo del
catálogo cruzado en `openapi.yaml` — reemplázalo por un UUID real de
`productos_maestro` si quieres que el `categoria`/`producto` que devuelve el
reporte salga resuelto de verdad. La línea de balón de gas no lleva
`productoId` (no es del catálogo cruzado) y por eso manda `categoria`
explícita.

201 = creado. 200 = reintento con la misma `Idempotency-Key`. 400/401/403/409
= ver `Error.error`/`message`.

---

## 2. GET /cierres-turno — listar/filtrar cierres de turno

```bash
curl -G "$BASE_URL/cierres-turno" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "estacionCodigo=CHANCAYLLO" \
  --data-urlencode "fechaDesde=2026-09-01" \
  --data-urlencode "fechaHasta=2026-09-03" \
  --data-urlencode "turno=TURNO1" \
  --data-urlencode "estado=ACTIVO" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20"
```

Todos los query params son opcionales (excepto que `estacionCodigo`, si lo
mandas, debe coincidir con la estación del token o responde 403). Para
"quién trabajó el día X" usa `usuarioCodigo=EMP-014` en vez de `turno`.

---

## 3. GET /cierres-turno/{id} — detalle completo (con `pagos[]`/`detalle[]`)

```bash
curl "$BASE_URL/cierres-turno/REEMPLAZAR-CON-UUID-DEL-CIERRE" \
  -H "Authorization: Bearer $TOKEN"
```

`id` sale de la respuesta del paso 1 o de un `id` del listado del paso 2.

---

## 4. POST /cierres-dia — registrar cierre de día

Idempotente igual que cierres-turno. **Este es el único endpoint que dispara
el evento `CierreDiaRegistrado` a EventBridge** para el servicio de
notificaciones de WhatsApp — `POST /cierres-turno` no lo dispara.

**`cierresTurnoIds` es OBLIGATORIO desde v1.76**: son los `id` que devolvió
cada `POST /cierres-turno` del día (paso 1) — el cliente (`fuelhub-local`) los
va acumulando durante el día y los manda todos juntos acá. Vincula cada
cierre de turno con este cierre de día (`cierres_turno.cierre_dia_id`); si
algún id no existe, no es de esta estación, no está `ACTIVO`, o ya estaba
vinculado a otro cierre de día, se rechaza el cierre de día COMPLETO (400) y
no se graba nada.

```bash
curl -X POST "$BASE_URL/cierres-dia" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  -d '{
    "codigoEstacion": "CHANCAYLLO",
    "fechaNegocio": "2026-09-03",
    "fecha": "2026-09-03T22:15:00-05:00",
    "total": 18500.00,
    "administrador": { "codigo": "ADM-002", "nombre": "María Gómez" },
    "cierresTurnoIds": [
      "b3f1c2a4-6e8d-4a3b-9c1e-2f5a7d9b0c3e",
      "REEMPLAZAR-CON-UUID-DEL-2DO-CIERRE-DE-TURNO",
      "REEMPLAZAR-CON-UUID-DEL-3ER-CIERRE-DE-TURNO"
    ]
  }'
```

---

## 5. GET /cierres-dia — listar/filtrar cierres de día

```bash
curl -G "$BASE_URL/cierres-dia" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "estacionCodigo=CHANCAYLLO" \
  --data-urlencode "fechaDesde=2026-09-01" \
  --data-urlencode "fechaHasta=2026-09-03" \
  --data-urlencode "estado=ACTIVO"
```

---

## 6. POST /compras — registrar abastecimiento

**No** lleva `Idempotency-Key` (bajo volumen, sin reintentos automáticos
esperados). **Cambió en v1.65** — `productoId` ya no es siempre obligatorio,
y el `tanqueId` suelto de antes se reemplaza por `destinos[]` (una compra
puede repartirse a varios tanques, incluso de otra estación). Dos ejemplos:

**6a. Combustible, repartido a un tanque (con merma real)** — la suma de
`destinos[].cantidad` puede ser MENOR que `cantidad`; la diferencia es
merma y sale calculada en la respuesta (`merma`), no la mandas tú. Nunca
puede ser MAYOR (se rechaza con 400).

```bash
curl -X POST "$BASE_URL/compras" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "codigoEstacion": "CHANCAYLLO",
    "productoId": "f7ec806f-0e5c-4949-8110-b48469fd3ecf",
    "proveedor": "Petroperú",
    "fecha": "2026-09-02T10:00:00-05:00",
    "cantidad": 3000.000,
    "costoUnitario": 14.250,
    "numeroGuia": "T001-000123",
    "destinos": [
      { "tanqueId": "REEMPLAZAR-CON-UUID-DE-TANQUE-REAL", "cantidad": 2980.000 }
    ]
  }'
```

**6b. Mercadería fuera de catálogo (sin `productoId`, sin tanque)** — sin
`productoId`, `productoNombre` y `categoria` pasan a ser obligatorios.

```bash
curl -X POST "$BASE_URL/compras" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "codigoEstacion": "CHANCAYLLO",
    "productoNombre": "Galletas surtidas",
    "categoria": "NO_COMBUSTIBLE",
    "proveedor": "Distribuidora Lima SAC",
    "fecha": "2026-09-02T10:00:00-05:00",
    "cantidad": 24,
    "costoUnitario": 3.50,
    "numeroGuia": "T001-000124"
  }'
```

`destinos` es opcional (se omite para mercadería, que no va a tanque). Los
`tanqueId` de `destinos` deben existir y estar activos — sácalos del
listado del paso 8 — pero pueden ser de OTRA estación (contingencia real de
combustible facturado a una estación y entregado en parte a otra).

---

## 7. PUT /compras/{id} — editar o anular una compra (v1.66)

PUT parcial — manda solo los campos que quieras cambiar, igual que
`PUT /tanques/{id}`. Permite tocar la cabecera (`proveedor`, `fecha`,
`cantidad`, `costoUnitario`, `numeroGuia`, `productoId`/`productoNombre`/
`categoria`) y/o el reparto a tanques (`destinos[]`, que REEMPLAZA por
completo el reparto anterior, no hace upsert fila por fila) en el mismo
request. No hay `DELETE` — se anula con `estado: "ANULADO"` (soft-delete,
mismo criterio que `cierres_turno`/`cierres_dia`); mandar `estado: "ACTIVO"`
reactiva una compra anulada.

**7a. Editar cabecera y reemplazar destinos**

```bash
curl -X PUT "$BASE_URL/compras/REEMPLAZAR-CON-UUID-DE-COMPRA-REAL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "proveedor": "Petroperú (corregido)",
    "cantidad": 2950.000,
    "destinos": [
      { "tanqueId": "REEMPLAZAR-CON-UUID-DE-TANQUE-REAL", "cantidad": 2930.000 }
    ]
  }'
```

**7b. Anular una compra**

```bash
curl -X PUT "$BASE_URL/compras/REEMPLAZAR-CON-UUID-DE-COMPRA-REAL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "estado": "ANULADO" }'
```

Si la compra sigue ligada a catálogo (`productoId` no nulo y no lo cambias
en este PUT), cualquier `categoria` que mandes se ignora — el catálogo
sigue mandando esa columna, igual que al crear (sección 6).

---

## 8. GET /tanques — listar tanques de una estación

```bash
curl -G "$BASE_URL/tanques" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "estacionCodigo=CHANCAYLLO"
```

---

## 9. PUT /tanques/{id} — actualizar/reasignar tanque

PUT parcial — manda solo los campos que quieras cambiar. El caso típico es
reasignar `productoId` (el backend actualiza `producto_asignado_en` solo si
cambia respecto al valor actual).

```bash
curl -X PUT "$BASE_URL/tanques/REEMPLAZAR-CON-UUID-DEL-TANQUE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "productoId": "f7ec806f-0e5c-4949-8110-b48469fd3ecf",
    "capacidad": 10000,
    "stockMinimo": 1500,
    "activo": true
  }'
```

---

## 10. GET /reportes/dia — reporte del día (combustible vs. no-combustible)

El endpoint que armamos hoy (v1.58/v1.59). `fechaNegocio` es **siempre
obligatorio**; `estacionCodigo` es obligatorio solo si el token no resuelve
a una única estación por sí solo (token multi-estación o wildcard `*`) — con
el token de una estación normal (como el de este ejemplo) puede omitirse.

```bash
curl -G "$BASE_URL/reportes/dia" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "fechaNegocio=2026-09-03" \
  --data-urlencode "estacionCodigo=CHANCAYLLO"
```

200 = reporte con `total`, `totalCombustible`, `totalNoCombustible`,
`totalSinClasificar` y `productos[]`. 404 = no hay un cierre de día `ACTIVO`
para esa estación/fecha (día aún no cerrado, o anulado) — probarlo después de
correr el paso 4 con la misma `fechaNegocio`/`estacionCodigo`.

---

## 11. GET /reportes/margen — margen estimado por sede

```bash
curl -G "$BASE_URL/reportes/margen" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "fechaDesde=2026-08-01" \
  --data-urlencode "fechaHasta=2026-08-31" \
  --data-urlencode "estacionCodigo=CHANCAYLLO"
```

---

## 12. GET /reportes/abastecimiento — autonomía de tanques vs. frecuencia real

```bash
curl -G "$BASE_URL/reportes/abastecimiento" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "estacionCodigo=CHANCAYLLO"
```

---

## 13. GET /reportes/dia/documento — reporte del día como PDF (v1.60)

Variante de `GET /reportes/dia` pensada para el bot de WhatsApp: en vez de
JSON, devuelve una URL firmada de S3 al PDF ya renderizado (válida por
`expiraEn` segundos, sin autenticación adicional para descargarla).

```bash
curl -G "$BASE_URL/reportes/dia/documento" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "fechaNegocio=2026-09-03" \
  --data-urlencode "estacionCodigo=CHANCAYLLO"
```

Respuesta esperada:
```json
{ "url": "https://...s3...amazonaws.com/reportes-dia/...pdf?X-Amz-...", "tipo": "application/pdf", "expiraEn": 600 }
```

Omite `estacionCodigo` con un token de una sola estación para el mismo
comportamiento; con un token cross-estación (multi-estación o wildcard `*`
— hoy solo `fuelhub-notificaciones-whatsapp`) omitirlo arma el PDF
**consolidado** de todas las estaciones del token, en vez del 400 que tira
`GET /reportes/dia` en ese mismo caso. 404 = no hay ningún cierre de día
`ACTIVO` para esa fecha (ni individual ni en ninguna estación del token).

---

## Bonus: colección lista para importar

Junto a este archivo va `FuelHub-Cloud.postman_collection.json` — impórtalo
directo en Postman (**Import → File**) y ya trae los 14 requests armados con
variables de colección (`baseUrl`, `accessToken`, etc.) y un script en el
request de Auth que guarda el `access_token` automáticamente después de
correrlo, así no tienes que copiarlo a mano en cada request. Solo tienes que
completar `baseUrl`, `clientId` y `clientSecret` en las variables de la
colección (ícono de ojito arriba a la derecha en Postman → Edit).
