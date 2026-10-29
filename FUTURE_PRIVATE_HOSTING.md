# ADAHRA · Hosting privado con edición multiusuario (propuesta, no implementada)

El sitio actual es estático a propósito: GitHub Pages no ejecuta backend y el
editor local evita publicar credenciales. Si en el futuro varias personas
deben editar el catálogo en línea, hace falta un backend autenticado y un
almacenamiento duradero. Este documento describe el contrato mínimo; **nada de
esto está implementado en el repositorio**.

## Objetivo

- Mantener la web pública rápida y de sólo lectura.
- Permitir que personas autorizadas creen, editen y eliminen fichas desde un
  panel privado.
- Evitar que un token de larga duración viva en el navegador.
- Conservar historial, validación y copias de seguridad.

## Arquitectura propuesta

```
Navegador (panel privado)
   │  HTTPS + cookie HttpOnly + CSRF
   ▼
API /api/v1  (Node, Python o serverless)
   │  validación del mismo esquema version 1
   ▼
Base de datos (PostgreSQL o SQLite gestionado)
   │
   └─ job de publicación → data/properties.json en el hosting estático
```

La web pública puede seguir leyendo un JSON generado, o consultar
`GET /api/v1/properties` con caché. El editor deja de ser un archivo estático
y pasa a requerir sesión.

## Contrato HTTP mínimo

Todas las rutas bajo `/api/v1`, JSON UTF-8, errores con `{ "error": { "code",
"message", "requestId" } }`.

| Método | Ruta | Efecto |
| --- | --- | --- |
| `GET` | `/properties` | Lista pública paginada y ordenada por `id`. |
| `GET` | `/properties/:id` | Ficha pública o 404. |
| `POST` | `/properties` | Crea una ficha; requiere sesión y CSRF. |
| `PUT` | `/properties/:id` | Reemplaza una ficha; requiere `If-Match` o `updatedAt`. |
| `DELETE` | `/properties/:id` | Elimina; requiere sesión y confirmación. |
| `POST` | `/auth/login` | Inicia sesión; responde cookie `HttpOnly`. |
| `POST` | `/auth/logout` | Revoca la sesión. |
| `GET` | `/health` | Estado sin datos sensibles. |

Reglas:

- El servidor revalida el mismo esquema (`version`, campos, límites, HTTPS).
- `POST`/`PUT` usan control de concurrencia optimista: si `updatedAt` no
  coincide, responde `409` con la ficha actual.
- `DELETE` es idempotente; un segundo intento responde `204` o `404` según la
  política elegida.
- Límite de cuerpo 2 MiB, 500 propiedades y rate limit por sesión/IP.
- Validación de `Content-Type`, tamaño y tipos antes de tocar la base.

## Autenticación y sesión

- Cookie de sesión `Secure`, `HttpOnly`, `SameSite=Lax` o `Strict`.
- Token CSRF aparte (double-submit o sincronizador) para `POST`/`PUT`/`DELETE`.
- Contraseñas con Argon2id o scrypt; nunca en texto plano.
- Sesiones con expiración corta y rotación; revocación en logout.
- Opcional: OAuth con un proveedor corporativo y lista de correos permitidos.
- Nunca guardar tokens en `localStorage`, `sessionStorage` ni en el HTML.

## Almacenamiento y publicación

- Tabla `properties` con columnas tipadas y `created_at`/`updated_at`.
- Tabla `audit_log` con actor, acción, `property_id`, timestamp y `request_id`
  (sin copiar descripciones completas ni datos personales innecesarios).
- Copia de seguridad diaria y prueba de restauración mensual.
- La publicación del JSON puede ser un job que exporta desde la base y hace
  commit a un repositorio estático, o un endpoint con CDN y caché corta.
- Si se usa commit automático, el job necesita un token de corto alcance y
  permisos mínimos; ese token vive en el servidor, nunca en el navegador.

## Migración desde el estado actual

1. Importar `data/properties.json` a la base con el mismo validador.
2. Mantener `GET /properties` compatible con el JSON actual.
3. Migrar el editor local a un panel autenticado que consuma la API.
4. Publicar primero en un entorno de staging y comparar el JSON exportado.
5. Cambiar la web pública cuando el contrato y las pruebas E2E estén verdes.

## Riesgos y controles

| Riesgo | Control |
| --- | --- |
| Edición concurrente | `updatedAt`/`If-Match` y respuesta `409`. |
| XSS en el panel | Sin `innerHTML`; CSP estricta; escapar todo texto. |
| CSRF | Cookie `SameSite` + token CSRF. |
| Robo de sesión | `HttpOnly`, `Secure`, expiración y revocación. |
| Pérdida de datos | Backups, auditoría y restauración probada. |
| Publicación accidental | Aprobación humana o job con allowlist y tests. |
| Abuso/DoS | Límites de cuerpo, rate limit y timeout. |

## Fuera de alcance

- Implementar la API, la base o el login en este repositorio.
- Elegir proveedor de hosting, base de datos o identidad.
- Configurar DNS, certificados o pagos.
- Convertir el editor local en una aplicación pública sin autenticación.
