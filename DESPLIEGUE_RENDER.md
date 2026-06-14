# 🚀 Subir tu Life OS a internet (Render) — guía paso a paso

Tu app quedará en un enlace público, prendida 24/7, accesible desde
cualquier lado, con tus datos guardados para siempre en Postgres.

---

## PARTE 1 — Subir el código a GitHub

1. Entra a https://github.com y crea cuenta (o inicia sesión).
2. Botón **New** (repositorio nuevo). Nombre: `kevin-lifeos`. Déjalo **Public**
   o Private (da igual). NO marques "Add README". Click **Create repository**.
3. GitHub te muestra una página con comandos. La forma más fácil sin instalar nada:
   - Click en **"uploading an existing file"** (link azul en esa página).
   - Arrastra TODOS los archivos de la carpeta `lifeos_web` EXCEPTO:
     `lifeos.db`, `actualizar.py`, la carpeta `__pycache__` y `server.log`.
     (Sube: app.py, db_layer.py, requirements.txt, Procfile, render.yaml,
      seed_data.json, doctor.py, migrar_a_nube.py, la carpeta `templates/`
      y la carpeta `static/`).
   - Abajo click **Commit changes**.

> 💡 Importante: respeta las carpetas. `index.html` va dentro de `templates/`,
> y `app.js` + `style.css` dentro de `static/`. Al arrastrar, GitHub mantiene
> las carpetas si arrastras las carpetas completas.

---

## PARTE 2 — Desplegar en Render

1. Entra a https://render.com y regístrate **con tu cuenta de GitHub**
   (botón "Sign in with GitHub"). Es gratis.
2. En el panel: **New +** → **Blueprint**.
3. Conecta tu repositorio `kevin-lifeos`. Render detecta el archivo
   `render.yaml` y configura TODO solo: el servicio web + la base de datos
   Postgres gratis, ya conectados.
4. Click **Apply**. Render empieza a construir (tarda 2-5 min la primera vez).
5. Cuando termine, tendrás un enlace tipo:
   **https://kevin-lifeos.onrender.com** ← esa es tu app pública. 🎉

La app arranca con tus datos semilla (deudas, hábitos, etc.). Ahora migramos
tus datos REALES del PC.

---

## PARTE 3 — Migrar tus datos del PC a la nube (una sola vez)

1. En Render → click en tu base de datos **kevin-lifeos-db** → busca
   **"External Database URL"** y cópiala (empieza con `postgresql://...`).
2. En tu PC, en la carpeta `lifeos_web` (donde está tu `lifeos.db` con tus datos),
   abre la terminal y corre:
   ```
   pip install psycopg2-binary
   python migrar_a_nube.py "PEGA-AQUI-LA-URL-EXTERNA"
   ```
   (con la URL entre comillas).
3. Verás "✓ tabla: N filas migradas" por cada tabla. Al terminar, recarga tu
   web de Render: ahí están todos tus datos. ✅

---

## De ahora en adelante

- **Tu app local** (PC) sigue funcionando igual con `python app.py`. No se dañó nada.
- **Tu app en la nube** es independiente: la usas desde el celular o cualquier PC.
- ¿Hiciste cambios al código y quieres actualizarla? Sube los archivos nuevos a
  GitHub (mismo paso de "uploading files") y Render la reconstruye sola.
- **Detalle del plan gratis:** si nadie la usa por ~15 min, se "duerme" y la
  primera visita tarda ~40 seg en despertar. Después va rápido. Normal y gratis.

> Añade la web a la pantalla de inicio del celular (Compartir → "Añadir a
> pantalla de inicio") y la tienes como app, desde cualquier lugar.
