# KEVIN · LIFE OS — Tu web personal

Tu Excel convertido en aplicación web: alcancía de deudas como jefe final de RPG,
hábitos con niveles de Haki, sueños, ranking de anime y libros.
**Todo queda guardado para siempre** en una base de datos SQLite (`lifeos.db`).

---

## 1. Lo que necesitas (una sola vez)

1. **Python 3** → descárgalo de https://www.python.org/downloads/
   ⚠ Al instalar marca la casilla **"Add Python to PATH"**.
2. **VS Code** (tu editor) → https://code.visualstudio.com/
3. Abre la terminal (en VS Code: Terminal → Nueva terminal) y escribe:
   ```
   pip install flask
   ```

## 2. Lanzarla (cada vez que quieras usarla)

1. Abre la terminal DENTRO de esta carpeta (en VS Code: Archivo → Abrir carpeta → lifeos_web).
2. Escribe:
   ```
   python app.py
   ```
3. Abre tu navegador en → **http://localhost:5000**
4. Para apagarla: Ctrl + C en la terminal. Tus datos NO se pierden.

La primera vez se crea `lifeos.db` con todos tus datos reales ya cargados
(deudas, plan mensual, 15 hábitos, 54 animes, sueños, libros).

## 3. Cómo funciona cada pestaña

- **Inicio**: elige el mes (julio 2026 → junio 2027) y mira ingreso, deudas,
  saldo, la torta y el diagnóstico (Modo guerra → Resistiendo → Zona 50/30/20).
- **⚔ Alcancía**: LA DEUDA es el jefe final con $25.219.306 de HP
  (Tarjeta DV + ADDI + Joseph + los 10 préstamos personales). Cada pago real
  que hagas, regístralo como ataque: la barra baja animada en tiempo real,
  y cuando una deuda llega a 0 aparece ☠ DERROTADA. Puedes deshacer con ✕.
- **Hábitos**: cuadrícula del mes actual real (se actualiza sola cada mes).
  Clic en una celda = x. El último día del mes presiona "Cerrar mes":
  tu % se guarda en el historial y si fue ≥70% conquistas el mes.
  El Haki (arriba a la derecha) sube por MESES conquistados: 6 = 👑 Rey.
- **Sueños / Anime / Libros**: igual que tu Excel pero vivo. En Anime solo
  cambias el puntaje y el ranking entero se reordena al instante.

## 4. Tus datos y backups

- `lifeos.db` **ES tu base de datos**. Cópialo a otra carpeta o a tu nube
  y tienes backup completo. Si lo borras, la app vuelve a nacer con los
  datos semilla (pierdes tus marcas y abonos).
- Para editar el plan de meses/deudas semilla: `seed_data.json`
  (solo aplica si borras lifeos.db y dejas que se regenere).

## 5. Imágenes y personalización

- Fondo y colores: edita `static/style.css` — las variables de color están
  arriba del todo (`--gold`, `--hp`, `--bg`...).
- ¿Quieres tu wallpaper de One Piece de fondo? Guarda la imagen en
  `static/img/fondo.jpg` y en el CSS, dentro de `body { }`, agrega:
  `background-image: url('/static/img/fondo.jpg'); background-size: cover;`

## 6. Ruta hacia la app de Apple (después)

1. **Hoy mismo (gratis)**: desde Safari en tu iPhone entra a la web
   (cuando esté en tu red local o desplegada) → Compartir → "Añadir a
   pantalla de inicio". Se ve y se siente como app.
2. **Web pública**: despliega gratis en Render.com o PythonAnywhere
   para entrar desde cualquier lado.
3. **App nativa real**: necesitas un Mac + Xcode + cuenta de desarrollador
   de Apple (USD 99/año), con Swift/SwiftUI — o empaquetar esta misma web
   con Capacitor. Ese es el paso final, cuando domines lo básico.

---
Hecho por Kevin con Claude · Junio 2026
