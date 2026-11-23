# E2E de la ruta con avales (sin WhatsApp)

Recorren el flujo completo contra un `next dev` con el bypass de pruebas y almacenamiento real:

Paso 3b → rutina (invita; los links salen en su respuesta) → los avales responden en `/aval/<token>` → rutina (quórum y desembolso simulado, rechazo o vencimiento).

Casos (`avales.e2e.ts`): feliz (2 aceptan → `disbursed`), 2 rechazos → `rejected`, vencida, identidad que no coincide (DPI que termina en `0000`) y luego corregida, link cerrado tras el quórum y doble aceptación simultánea (un solo desembolso).

## Requisitos del server

- `next dev` con `ENABLE_TEST_BYPASS=true` (simula RENAP, `valida_cupo` y el desembolso; WhatsApp siempre simulado).
- Credenciales del almacenamiento (`AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`) en el entorno del server. Los tests no las leen.
- `JOBS_SECRET` es opcional: con el bypass, la rutina acepta el valor de desarrollo.

## Correr

```bash
# 1. server (otra terminal), por ejemplo en el puerto 3020
npm run dev -- -p 3020

# 2. tests
E2E_BASE_URL=http://localhost:3020 npx playwright test
```

Si falta el navegador: `npx playwright install chromium`.

Cada caso tarda entre 30 y 60 s: una corrida de la rutina que libera espera unos 12-15 s.

## Datos

- Cada solicitud usa `authorization` = `TEST-AVALES-e2e-<caso>-<id>` y datos ficticios. Los registros no se borran.
- Los teléfonos de prueba empiezan con 1 (solicitante `19000001`, avales `100…`, `101…`, `102…`). En Guatemala no hay números asignados con ese prefijo, así que ningún dato de prueba apunta a una persona real.
- La rutina procesa todas las solicitudes pendientes de la base, no solo las del test. No la corras a la vez desde otro server (respondería 409, o invitaría a los avales antes que el test).

## Herramientas de desarrollo que usan

Todas responden 404 fuera de `next dev` con el bypass:

- `/dev/avales/solicitud?auth=TEST-AVALES-<id>`: el Paso 3b real con un solicitante ficticio.
- `/dev/avales/rutina`: botón **Correr rutina**, con el reporte y los links.
- `GET /dev/avales/api/estado?auth=…`: estados de la solicitud y de sus avales, sin datos personales.
- `POST /dev/avales/api/vencer?auth=…`: mueve `expires-at` al pasado. Solo para TEST-AVALES-* en `pending_guarantors`.
- `POST /dev/avales/api/rutina`: corre la rutina desde el servidor.
