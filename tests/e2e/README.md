# E2E de la ruta con avales (sin WhatsApp)

Recorren el flujo contra un `next dev` con el bypass de pruebas y almacenamiento real:

Paso 3b → rutina (invita; los links salen en su respuesta) → los avales responden en `/aval/<token>` → rutina (rechazo o vencimiento).

Aceptar un aval consulta **RENAP de verdad**: el DPI y el nombre completo tienen que coincidir con el registro, y ya no hay validación simulada, ni siquiera con el bypass. Por eso los casos de aceptación son una **prueba manual** (abajo). Los casos automáticos nunca aceptan y nunca consultan RENAP.

## Casos automáticos (`avales.e2e.ts`)

1. **2 rechazos**: la solicitud queda `rejected` y el tercer link, cerrado.
2. **Vencida**: el link muestra "venció" y la rutina pasa la solicitud a `expired`.
3. **Link cerrado**: el tercer aval tiene el formulario abierto mientras la solicitud se rechaza; cuando responde, ve la pantalla de cerrado.
4. **Doble rechazo simultáneo del mismo aval** (dos pestañas): queda registrada una sola respuesta; la otra pestaña ve "estamos registrando otra respuesta" o "cerrado".

## Prueba manual de aceptación

Necesita personas reales que acepten ser aval de prueba, con su DPI y su nombre completo **exactos** (tal como están en RENAP). Las tildes y las mayúsculas no importan, pero no puede faltar ni sobrar ningún nombre ni apellido. Nunca uses datos de alguien sin su permiso, ni los escribas en archivos, issues o logs.

> **Los datos quedan guardados.** El DPI, el nombre, el teléfono y la respuesta completa de RENAP (`renap-raw`, con los datos oficiales de la persona) quedan en la tabla de avales de la base, como evidencia. Quien es dueño de los datos decide cuándo purgarlos; los agentes nunca borran registros.

**Con una sola persona real** solo se prueban los pasos 3 y 4 en un aval (identidad que no coincide y aceptación). El quórum, el desembolso y el link 3 cerrado (pasos 5 y 6) necesitan una **segunda** persona real que dé su permiso; sin ella, la solicitud se queda con un solo aval autorizado.

Además, el server necesita en su entorno `RENAP_TOKEN` y acceso a la API de RENAP desde esa máquina. `RENAP_BASE_URL` es opcional y es solo el origen (`https://host`, sin ruta ni `/` final); si falta, se usa el de por defecto del código.

1. Abre `/dev/avales/solicitud` y llena los 3 avales: en el aval 1 y el aval 2 pon el DPI y el nombre completo exactos de las personas reales, y en el aval 3 datos ficticios. Envía.
2. Abre `/dev/avales/rutina` y pulsa **Correr rutina**: el reporte trae los 3 links.
3. **Identidad que no coincide**: abre el link del aval 1, cambia una letra del nombre, marca la declaración y pulsa **Avalar**. Se ve "No pudimos confirmar tus datos…" y el formulario sigue abierto.
4. **Aceptación**: corrige el nombre y pulsa **Avalar** otra vez: "¡Gracias por tu apoyo!". Repite con el link del aval 2.
5. **Doble aceptación** (opcional): antes del paso 4, abre el link del aval 2 en dos pestañas y pulsa **Avalar** en las dos a la vez: una ve "¡Gracias por tu apoyo!" y la otra "estamos registrando otra respuesta" o "cerrado".
6. Pulsa **Correr rutina** otra vez: la solicitud pasa a quórum y se desembolsa (desembolso simulado con el bypass). Abre el link del aval 3: muestra "Esta solicitud ya se resolvió".
7. Comprueba los estados en `GET /dev/avales/api/estado?auth=<la authorization que muestra la página del paso 1>`.

**Qué esperar con datos ficticios:** si alguien pulsa **Avalar** con un DPI o un nombre inventados, ahora se ve "No pudimos confirmar tus datos…" (RENAP no coincide) o "No pudimos registrar tu respuesta… Intentar de nuevo" (RENAP no disponible, por ejemplo sin `RENAP_TOKEN` o sin acceso a la API). Es lo esperado: ya no hay un "dejar pasar" simulado.

## Requisitos del server

- `next dev` con `ENABLE_TEST_BYPASS=true`. Simula `valida_cupo` y el desembolso; WhatsApp siempre está simulado. RENAP **no** se simula.
- Credenciales del almacenamiento (`AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`) en el entorno del server. Los tests no las leen.
- `JOBS_SECRET` es opcional: con el bypass, la rutina acepta el valor de desarrollo.
- `RENAP_TOKEN` (y, opcional, `RENAP_BASE_URL`, solo el origen `https://host`) solo para la prueba manual de aceptación.

## Correr

```bash
# 1. server (otra terminal), por ejemplo en el puerto 3020
npm run dev -- -p 3020

# 2. tests
E2E_BASE_URL=http://localhost:3020 npx playwright test
```

Si falta el navegador: `npx playwright install chromium`.

Cada caso tarda entre 10 y 40 s.

## Datos

- Cada solicitud usa `authorization` = `TEST-AVALES-e2e-<caso>-<id>` y datos ficticios. Los registros no se borran.
- Los teléfonos de prueba empiezan con 1 (solicitante `19000001`, avales `100…`, `101…`, `102…`). En Guatemala no hay números asignados con ese prefijo, así que ningún dato de prueba apunta a una persona real.
- La rutina procesa todas las solicitudes de prueba pendientes de la base, no solo las del test. No la corras a la vez desde otro server (respondería 409, o invitaría a los avales antes que el test).

## Herramientas de desarrollo que usan

Todas responden 404 fuera de `next dev` con el bypass:

- `/dev/avales/solicitud?auth=TEST-AVALES-<id>`: el Paso 3b real con un solicitante ficticio.
- `/dev/avales/rutina`: botón **Correr rutina**, con el reporte y los links.
- `GET /dev/avales/api/estado?auth=…`: estados de la solicitud y de sus avales (y el candado de respuesta), sin datos personales.
- `POST /dev/avales/api/vencer?auth=…`: mueve `expires-at` al pasado. Solo para TEST-AVALES-* en `pending_guarantors`.
- `POST /dev/avales/api/rutina`: corre la rutina desde el servidor.
