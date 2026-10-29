# ADAHRA Bienes Raíces · catálogo inmobiliario estático

Web pública de sólo lectura de **ADAHRA Bienes Raíces** para GitHub Pages y editor local que importa,
valida y exporta `data/properties.json`. No hay backend, base de datos,
autenticación remota ni claves en el navegador.

## Cómo funciona

```
data/properties.json  →  public-app.js  →  index.html (público)
        ▲
        │ exportar / reemplazar / commit
admin-app.js  →  admin.html (editor local, nunca se publica)
```

- La web pública lee `./data/properties.json` con `cache: "no-store"`.
- El editor trabaja en memoria: cargar, importar, agregar, editar, borrar y
  exportar. No escribe en Internet ni en el servidor.
- La publicación es un acto humano: reemplazar el JSON, ejecutar pruebas y
  hacer commit/push. El workflow sólo publica la allowlist estática.

## Uso local

Requisitos: Python 3 y Node.js 22 o superior.

```bash
./start.sh          # http://127.0.0.1:8782/index.html
./start-admin.sh    # http://127.0.0.1:8783/admin.html
```

Los dos servidores escuchan sólo en `127.0.0.1`, en primer plano, y no detienen
procesos ajenos. Si el puerto está ocupado, usa `PORT=otro_puerto ./start.sh`.

## Editar el catálogo

1. Abre el editor local con `./start-admin.sh`.
2. Pulsa **Cargar JSON actual** o **Importar archivo JSON**.
3. Agrega, edita o elimina fichas. El estado **Cambios sin exportar** protege
   contra cerrar la pestaña por accidente.
4. Pulsa **Exportar properties.json**. El archivo se descarga (o se guarda con
   el selector de archivos si el navegador lo ofrece).
5. Reemplaza `data/properties.json` con el archivo exportado.
6. Ejecuta `npm test && npm run build:pages && npm run test:e2e`.
7. Haz commit y push. El workflow publica el nuevo catálogo.

> Los cambios del editor sólo son globales después del push y del despliegue.
> La copia en memoria de otra persona no cambia.

## Esquema del documento

```json
{
  "version": 1,
  "updatedAt": "2026-03-01T12:00:00.000Z",
  "properties": [
    {
      "id": "UI-001",
      "title": "Casa con patio en Del Valle",
      "operation": "venta",
      "type": "casa",
      "neighborhood": "Del Valle",
      "city": "Ciudad de México",
      "state": "CDMX",
      "address": "Calle de prueba 123",
      "price": 4500000,
      "construction": 220,
      "lot": 300,
      "beds": 3,
      "baths": 2.5,
      "parking": 2,
      "year": 2015,
      "description": "Casa de dos niveles con patio, luz natural y cocina integral.",
      "features": ["Patio", "Cochera", "Cocina integral"],
      "image": "https://example.com/casa.jpg",
      "alt": "Fachada de casa con patio",
      "createdAt": "2026-01-10T12:00:00.000Z",
      "updatedAt": "2026-02-15T18:30:00.000Z"
    }
  ]
}
```

Reglas principales:

- `version` debe ser `1`; `updatedAt` es `null` o ISO-8601.
- `id` con formato `UI-001`, único, mayúsculas y mínimo tres dígitos.
- `operation`: `venta` o `renta`; `type`: `casa`, `departamento`,
  `penthouse` o `terreno`.
- `image` debe ser una URL `https://`; `alt` es obligatorio.
- Terreno: `construction` debe ser `null`; `lot` puede ser numérico.
- Máximo 500 propiedades y 2 MiB de JSON.
- Se rechazan campos desconocidos y fechas inválidas.

## Pruebas

```bash
npm test              # documento, markup y build
npm run build:pages   # genera _site/ con allowlist exacta
npm run test:e2e      # Firefox headless con perfil temporal
npm run test:all      # todo lo anterior en orden
```

No se requieren dependencias npm. El E2E usa Firefox y WebDriver BiDi; nunca
abre el perfil personal del navegador.

## Archivos

| Archivo | Función |
| --- | --- |
| `index.html`, `public-app.js` | Web pública de sólo lectura. |
| `properties-data.js` | Modelo, validación, esquema, formato y repositorio estático. |
| `data/properties.json` | Catálogo publicado. |
| `admin.html`, `admin-app.js` | Editor local; nunca forma parte de `_site/`. |
| `assets/adahra-logo-full.webp` | Logotipo completo para el hero (800×771). |
| `assets/adahra-mark.webp` | Monograma para cabecera, vacío y pie (320×296). |
| `assets/favicon.png` | Icono local de 64×64. |
| `scripts/generate-assets.py` | Generador reproducible de los assets con Pillow. |
| `scripts/build-pages.mjs` | Allowlist, auditoría y artefacto de Pages. |
| `.github/workflows/pages.yml` | Pruebas, build y despliegue con acciones oficiales. |
| `start.sh`, `start-admin.sh` | Servidores locales en `127.0.0.1`. |
| `tests/` | Pruebas unitarias, de markup, build y E2E. |

## Seguridad

- Sin Firebase, Firestore, tokens, contraseñas ni secretos en el cliente.
- Sin `innerHTML`, `eval`, `new Function` ni manejadores inline.
- El build falla si aparece un archivo fuera de la allowlist, una referencia
  Firebase o un patrón de secreto.
- El editor no se publica: `_site/` contiene sólo ocho archivos.
- Los favoritos se guardan únicamente en `localStorage` del visitante, bajo la
  clave `adahra-favoritos-v1`.
- Las imágenes de marca son assets locales optimizados; el generador
  reproducible vive en `scripts/generate-assets.py` y no forma parte del sitio.
- Las fotos originales `WhatsApp Image *.jpeg` están ignoradas por Git y no se
  publican: sólo se versionan los derivados optimizados de `assets/`
  (`adahra-logo-full.webp`, `adahra-mark.webp` y `favicon.png`).

## Despliegue

Consulta [DEPLOY_GITHUB.md](DEPLOY_GITHUB.md) para los pasos humanos y
[FUTURE_PRIVATE_HOSTING.md](FUTURE_PRIVATE_HOSTING.md) si más adelante se
necesita edición multiusuario con backend.
