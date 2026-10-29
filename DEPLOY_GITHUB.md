# Despliegue en GitHub Pages

Este repositorio no se ha inicializado, no se ha publicado y no tiene remoto.
Los pasos siguientes son humanos: requieren tu cuenta de GitHub y tu decisión
explícita. El proyecto no contiene tokens ni credenciales.

## Requisitos

- Repositorio en GitHub (público o privado con Pages disponible).
- Rama `main` o `master` como rama de publicación.
- Acceso a **Settings → Pages** del repositorio.
- Node.js 22 o superior sólo para validar en local; el workflow usa Node 22.

## Antes de publicar

```bash
npm test
npm run build:pages
npm run test:e2e
```

Comprueba que `_site/` contiene exactamente:

```
.nojekyll
assets/adahra-logo-full.webp
assets/adahra-mark.webp
assets/favicon.png
data/properties.json
index.html
properties-data.js
public-app.js
```

No debe aparecer `admin.html`, `tests/`, `scripts/`, `package.json`,
`node_modules/`, documentación ni archivos Firebase.

## Pasos humanos

1. Crea el repositorio en GitHub (sin README ni licencia generados, para evitar
   conflictos).
2. En la carpeta del proyecto:

   ```bash
   git init
   git add .
   git commit -m "Catálogo estático con editor local"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git push -u origin main
   ```

   Revisa antes `git status` y `git diff --cached`. No subas secretos,
   `node_modules/`, `_site/` ni archivos `.env`.

3. En GitHub ve a **Settings → Pages**.
4. En **Build and deployment → Source** elige **GitHub Actions**.
5. El workflow `.github/workflows/pages.yml` se ejecutará en el próximo push o
   manualmente desde **Actions → Deploy static site to GitHub Pages → Run
   workflow**.
6. Espera a que terminen los jobs `build` y `deploy`. La URL aparece en el
   entorno `github-pages` y en **Settings → Pages**.

No necesitas crear una rama `gh-pages` ni configurar un token: el workflow usa
`GITHUB_TOKEN` con permisos mínimos (`contents: read`, `pages: write`,
`id-token: write`).

## Verificación posterior

- Abre la URL publicada y comprueba que el catálogo carga.
- Comprueba que `https://TU_DOMINIO/admin.html` devuelve 404.
- Comprueba que `https://TU_DOMINIO/data/properties.json` responde con el JSON.
- En DevTools → Network no debe aparecer `firebase`, `firestore` ni
  `identitytoolkit`.
- En **Actions**, el job `build` debe mostrar `build-pages: OK · 8 archivos`.

## Actualizar el catálogo

1. `./start-admin.sh`, edita y exporta `properties.json`.
2. Reemplaza `data/properties.json`.
3. `npm test && npm run build:pages`.
4. `git add data/properties.json && git commit -m "Actualiza catálogo"`.
5. `git push`.

El workflow vuelve a probar, construir y desplegar. Si el JSON es inválido, el
job `build` falla y Pages conserva la versión anterior.

## Dominio personalizado (opcional)

1. En **Settings → Pages → Custom domain**, escribe el dominio.
2. Crea en tu DNS un registro `CNAME` hacia `TU_USUARIO.github.io`.
3. Activa **Enforce HTTPS** cuando GitHub emita el certificado.
4. No agregues un archivo `CNAME` manual si usas la configuración de Pages; el
   workflow no lo genera y la allowlist no lo incluye.

## Reversión

- Para volver a un catálogo anterior: `git revert <commit>` y push.
- Para despublicar: **Settings → Pages → Unpublish site** o cambia la fuente a
  **None**. Esto no borra el repositorio.
- Si un despliegue falla, revisa el log del job y vuelve a ejecutar el workflow
  desde el último commit válido.

## Qué no hace este proyecto

- No crea el repositorio, no hace commit, no hace push y no activa Pages.
- No configura DNS ni certificados.
- No publica el editor local.
- No permite edición multiusuario en línea: para eso consulta
  [FUTURE_PRIVATE_HOSTING.md](FUTURE_PRIVATE_HOSTING.md).
