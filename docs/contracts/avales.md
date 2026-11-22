# Contrato técnico: solicitud con avales

Versión 1.0 · 2026-11-22 · Estado: propuesta para revisión

Define lo que comparten el frontend, el backend y las rutinas para la ruta con avales. Lo que no está aquí no es parte del contrato.

## 1. Ruta

| Variable | Valores | Por defecto |
|---|---|---|
| `TELOPRESTO_RUTA` | `aval` · `normal` | `aval` |

- `normal`: el flujo de hoy. El Paso 3 desembolsa en el momento.
- `aval`: el Paso 3 no desembolsa. El botón dice **Solicitar aval** y abre el formulario de avales.
- Todos los solicitantes van por la misma ruta. La regla por solicitante queda para una versión posterior y solo cambia esta decisión, no el resto del contrato.
- Los Pasos 0, 1 y 2 no cambian en ninguna ruta. El Paso 1 sigue pidiendo los datos de empresa: el contrato los usa.

## 2. Datos (Airtable, base de Te lo Presto)

Tres tablas nuevas junto a `applications`. Nombres de campo en inglés, como `applications`.

### `requests` (una por solicitud con avales)
| Campo | Tipo | Nota |
|---|---|---|
| `authorization` | texto (primario) | el número de autorización generado en el Paso 0 |
| `phone`, `identification`, `full-name`, `email` | texto | del solicitante |
| `company`, `age`, `marital-status`, `address` | texto | para el contrato |
| `cupo-id` | texto | `idSolicitud` de `valida_cupo` |
| `approved-amount`, `requested-amount`, `commission`, `commission-pct` | número | del Paso 3 |
| `status` | selección | ver §3 |
| `expires-at` | fecha y hora | creación + 48 h |
| `quorum-at`, `released-at` | fecha y hora | |
| `release-code`, `release-message` | texto | respuesta de `Ejecuta_Desembolso` |
| `contract-url` | url | pagaré generado |
| `audit` | texto largo (JSON) | fingerprint, IP, idioma, resolución, hash del OTP |

### `guarantors` (tres por solicitud)
| Campo | Tipo | Nota |
|---|---|---|
| `request` | vínculo a `requests` | |
| `position` | número | 1, 2 o 3 |
| `full-name`, `phone`, `identification` | texto | lo que dio el solicitante |
| `relationship` | selección | hermano/a, hijo/a, padre/madre, cónyuge, amigo/a, vecino/a, compañero/a de trabajo, otro |
| `token-hash` | texto | SHA-256 del token del link (nunca el token) |
| `status` | selección | ver §3 |
| `invited-at`, `answered-at` | fecha y hora | |
| `renap-result` | selección | `MATCH_UNICO` · `HOMONIMOS` · `SIN_RESULTADOS` · `ERROR` |
| `renap-raw` | texto largo (JSON) | respuesta cruda, evidencia de cumplimiento |
| `evidence` | texto largo (JSON) | IP, user agent, fecha, texto aceptado y su hash |

### `guarantor-leads`
Un registro por aval que certificó: nombre oficial (RENAP), teléfono, DPI, fecha, solicitud de origen, `thanked-at`.

## 3. Estados

### Solicitud (`requests.status`)
```
pending_guarantors ──(2 autorizados)──▶ quorum ──▶ releasing ──(código 0 o 34)──▶ disbursed
        │                                              └──(otro código o error)──▶ release_failed
        ├──(48 h sin quórum)──▶ expired
        ├──(2 rechazos: ya no hay quórum posible)──▶ rejected
        └──(cupo menor al monto al liberar)──▶ not_approved
```
- `release_failed` no se reintenta sola: queda visible para que otro equipo decida.
- En la pantalla, `pending_guarantors` se muestra como **En revisión**.

### Aval (`guarantors.status`)
`pending` (creado) → `invited` (WhatsApp enviado) → `authorized` (aceptó y RENAP coincide) · `rejected` (rechazó) · `identity_mismatch` (RENAP no coincide; puede corregir sus datos mientras el link siga abierto) · `closed` (ya hubo quórum o la solicitud terminó) · `expired` (pasaron 48 h).

## 4. Link del aval

- Ruta: `/aval/<token>`.
- Token: 32 bytes aleatorios en base64url. En Airtable solo se guarda su SHA-256. La URL no lleva DPI, teléfono ni el id de la solicitud.
- Un token sirve para un solo aval. Al abrirlo, la página muestra según el estado:

| Estado | Pantalla |
|---|---|
| `pending`, `invited`, `identity_mismatch` y la solicitud en `pending_guarantors` | formulario: confirma nombre, DPI y teléfono; **Avalar** o **Rechazar** (con aviso de lo que implica) |
| `authorized`, `rejected` | ya respondido |
| `closed` | la solicitud ya se resolvió |
| `expired` o la solicitud venció | vencido |
| token desconocido | link no válido |

- Muestra el primer nombre del solicitante, el monto y el tiempo restante; nunca datos de los otros avales.

## 5. Operaciones

Todas corren en el servidor.

| Operación | Quién la llama | Qué hace |
|---|---|---|
| `submitGuarantorRequest(data)` (server action) | Paso 3b | Valida estructura otra vez, crea `requests` (`pending_guarantors`, `expires-at` = +48 h) y 3 `guarantors` (`pending`) con su token. Si ya existe una solicitud con la misma `authorization`, devuelve la existente (reintento seguro). |
| `getGuarantorView(token)` | `/aval/<token>` | Devuelve el estado de la pantalla de §4. |
| `answerGuarantor(token, answer, data)` (server action) | `/aval/<token>` | `reject` → `rejected`. `accept` → RENAP (§6): coincide → `authorized`; no coincide → `identity_mismatch`. Guarda evidencia. No libera dinero. |
| `POST /api/jobs/guarantors` | rutina cada 5 min | Ver §7. Protegida con `JOBS_SECRET` (encabezado `Authorization: Bearer`). |
| `releaseRequest(input)` (`lib/release.ts`) | Paso 3 en ruta `normal`; la rutina en ruta `aval` | `Ejecuta_Desembolso` y pagaré. Idempotente por `authorization`. |

## 6. Validación de identidad (RENAP vía GTS)

- Autenticación `POST /api/auth/local`; JWT en memoria 50 min; un reintento si la búsqueda responde 401. Timeout 25 s.
- Búsqueda por nombre: `GET /api/infos/search?q=<nombre completo>`. Normalizar la respuesta (arreglo, `data` o `results`).
- **El aval se autoriza solo si algún candidato tiene `CUI` igual al DPI que dio.** Con varios candidatos con ese CUI no hay ambigüedad; si hay homónimos sin CUI coincidente, desempate por los últimos 8 dígitos de `TELEFONO`.
- Se guarda siempre la respuesta cruda en `renap-raw`.
- El endpoint es HTTP sin TLS: se llama solo desde el servidor, nunca desde el navegador.

## 7. Rutina (`/api/jobs/guarantors`)

La rutina es el **único** proceso que libera dinero, y procesa las solicitudes una por una. Así dos certificaciones simultáneas no pueden desembolsar dos veces.

En cada corrida:
1. **Invitar:** avales `pending` → WhatsApp (§8) → `invited`. Reintenta en la siguiente corrida si falla.
2. **Rechazos:** solicitudes con 2 avales `rejected` → `rejected`, avales abiertos → `closed`, aviso al solicitante.
3. **Vencimientos:** solicitudes `pending_guarantors` con `expires-at` vencido → `expired`, avales abiertos → `expired`, aviso.
4. **Quórum:** solicitudes con 2 avales `authorized` → `quorum`, avales abiertos → `closed`.
5. **Liberar** cada solicitud en `quorum`:
   1. Pasarla a `releasing` (si ya no está en `quorum`, saltarla).
   2. `valida_cupo`. Si el cupo es menor al monto → `not_approved` y aviso.
   3. `releaseRequest` con el `idSolicitud` nuevo y el monto aprobado.
   4. Código 0 o 34 → `disbursed`, pagaré, WhatsApp con el contrato. Otro resultado → `release_failed`.
6. **Leads:** avales `authorized` sin `thanked-at` → `guarantor-leads` y WhatsApp de agradecimiento.

Disparador: un workflow programado de n8n (Wa2Desk) que llama al endpoint cada 5 minutos. No depende del plan de Vercel.

## 8. WhatsApp

Por el API n8n de Wa2Desk, desde la misma línea por la que hoy sale el contrato. Plantillas (requieren aprobación de Meta):

| Plantilla | A quién | Variables |
|---|---|---|
| invitación al aval | aval | nombre del aval, nombre del solicitante, relación, monto, link |
| contrato aprobado | solicitante | nombre, monto, link del contrato |
| solicitud vencida o rechazada | solicitante | nombre |
| agradecimiento | aval | nombre |

## 9. Variables de entorno nuevas

`TELOPRESTO_RUTA`, `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `RENAP_BASE_URL`, `RENAP_IDENTIFIER`, `RENAP_PASSWORD`, `WA2DESK_N8N_URL`, `WA2DESK_N8N_KEY`, `JOBS_SECRET`, `APP_BASE_URL` (para armar el link del aval).

Ninguna va en el código. Ningún log imprime DPI, teléfonos completos ni tokens.

## 10. Abierto

- Qué pasa con `release_failed` (lo define otro equipo).
- Si `Ejecuta_Desembolso` rechaza un `idSolicitud` repetido: hasta confirmarlo, la idempotencia vive de nuestro lado (`requests.status`).
