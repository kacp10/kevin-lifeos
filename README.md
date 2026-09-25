# Kevin Life OS

Kevin Life OS es una aplicación web personal creada para centralizar en un solo lugar la organización diaria, las finanzas personales, los hábitos, el aprendizaje y el desarrollo profesional.

El proyecto comenzó como una forma de trasladar información personal que antes estaba dispersa entre hojas de cálculo y notas, pero con el tiempo evolucionó hasta convertirse en un sistema propio con módulos conectados entre sí y persistencia real de datos.

Actualmente el sistema se encuentra en la versión **V178**.

## Qué incluye

Kevin Life OS está dividido en varias áreas que cumplen funciones diferentes, pero comparten la misma base de información.

### Life

Es el núcleo de organización personal.

Desde aquí se administran las actividades del día, hábitos, rutina, turnos, objetivos y elementos que requieren atención diaria.

Las actividades pueden estar asociadas a distintos hábitos y algunas dependen del estado de Focus. Los elementos que dejan de estar en Focus dejan también de formar parte de las misiones diarias correspondientes.

### Finanzas y deudas

El sistema permite llevar control de deudas personales, tarjetas de crédito, compras a cuotas, pagos mensuales y gastos.

Incluye, entre otras funciones:

- seguimiento individual de cada deuda;
- compras a cuotas;
- cálculo mensual de obligaciones;
- rediferido individual de compras;
- refinanciación de tarjetas compatibles;
- sincronización del cupo disponible de las tarjetas;
- registro y reversión de compras;
- recordatorios de pagos pendientes;
- desglose mensual cuota por cuota.

El objetivo es que Home refleje el estado financiero real de acuerdo con las compras, pagos, eliminaciones y cambios realizados en el sistema.

### Shopping

Hunter Supply Request permite registrar compras y conectarlas directamente con el sistema financiero.

Dependiendo del método de pago, una compra puede convertirse en gasto inmediato o en una compra a cuotas vinculada a una tarjeta. Las operaciones relacionadas se registran de forma conjunta para evitar estados financieros parciales.

### Habits

El módulo de hábitos registra cumplimiento diario y progreso acumulado.

Una misma actividad puede contribuir a varios hábitos sin convertirse por ello en varias actividades independientes. Recovery utiliza la actividad como unidad de recuperación, evitando duplicados cuando una misión alimenta más de un hábito.

### Language Hunter

Language Hunter está destinado al entrenamiento de idiomas y conserva su propia lógica independiente de Study.

Permite trabajar con sesiones, correcciones, conceptos, vocabulario, tareas y reportes. Su importador admite tanto el formato histórico como reportes más naturales con distintas variantes de encabezados y separadores.

English puede utilizar Focus para decidir si aparece en las actividades del día, pero continúa utilizando su flujo especializado y no se convierte en una misión genérica de Study.

### Hunter Profile

Hunter Profile reúne información personal de referencia y sistemas de seguimiento que no pertenecen directamente a la rutina diaria.

Incluye Hunter Code, una colección permanente de 41 principios personales en español e inglés. Estos principios funcionan como referencia y no generan puntos, checks, hábitos ni progreso automático.

### Hunter Skill Academy

Hunter Skill Academy funciona como un espacio libre de aprendizaje.

Su propósito es practicar y explorar temas sin convertir automáticamente ese aprendizaje en experiencia profesional demostrada. Completar contenido en Academy no incrementa por sí solo el nivel de Work Mode.

### Work Mode

Work Mode es un entorno separado de Life para entrenamiento y progreso profesional.

Mantiene cuatro contextos independientes:

- Data Analyst
- Software Developer
- Cyber Defense
- Machine Learning

Cada contexto conserva su propio progreso.

Las misiones siguen el flujo:

`Backlog -> Ready -> In progress -> AI review -> Changes requested / Done`

Las revisiones aprobadas generan evidencia profesional. Los cursos o checks por sí solos no representan dominio y cualquier ascenso de nivel requiere una decisión manual del usuario.

Work Mode también incluye Mission System, Command Center, Skills & Level Coach, Market Intelligence, Portfolio Operations y Work Guidance.

## Arquitectura

Kevin Life OS utiliza una arquitectura web sencilla y centralizada.

### Backend

El servidor está desarrollado en **Python con Flask**.

`app.py` contiene gran parte de la lógica de aplicación y expone los endpoints utilizados por el frontend.

La capa `db_layer.py` abstrae el acceso a datos para permitir trabajar con distintos motores según el entorno.

### Frontend

La interfaz utiliza HTML, CSS y JavaScript.

La mayor parte de la interacción del navegador se concentra en:

`static/app.js`

Los estilos principales se encuentran en:

`static/style.css`

### Base de datos

En desarrollo local puede utilizarse **SQLite** mediante `lifeos.db`.

En producción el proyecto utiliza **PostgreSQL**.

El sistema contiene mecanismos de migración y compatibilidad para conservar bases creadas con versiones anteriores sin tener que reconstruirlas desde cero.

## Estructura general

Los archivos más importantes del proyecto son:

```text
app.py                  Servidor Flask y lógica principal

db_layer.py             Acceso y compatibilidad de base de datos

seed_data.json          Datos iniciales utilizados cuando corresponde

static/
  app.js                Lógica principal del frontend
  style.css             Estilos generales

templates/              Vistas HTML

tests/                  Pruebas automatizadas
```

La estructura real puede contener archivos adicionales relacionados con despliegue, documentación, recursos estáticos y pruebas específicas.

## Ejecutar el proyecto localmente

### Requisitos

- Python 3
- pip
- las dependencias definidas por el proyecto

Se recomienda trabajar dentro de un entorno virtual.

### Crear el entorno virtual

En Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
```

### Instalar dependencias

Si el proyecto contiene `requirements.txt`:

```powershell
pip install -r requirements.txt
```

### Iniciar la aplicación

```powershell
python app.py
```

Después puede abrirse en:

```text
http://localhost:5000
```

Para detener el servidor utiliza `Ctrl + C` en la terminal.

## Persistencia y copias de seguridad

Los datos no dependen del navegador.

Cuando se trabaja con SQLite, `lifeos.db` contiene la información persistente local. Antes de realizar cambios importantes o migraciones se recomienda guardar una copia del archivo.

En producción, los datos se almacenan en PostgreSQL y deben respaldarse desde el proveedor correspondiente.

Eliminar una base de datos local no debe considerarse un método normal de actualización, porque puede provocar pérdida de información personal acumulada.

## Despliegue

El proyecto está preparado para ejecutarse en producción con **Render**, utilizando **Gunicorn** como servidor WSGI y PostgreSQL como base de datos.

Las modificaciones que introducen cambios de esquema deben conservar compatibilidad con bases existentes. Por esa razón, Kevin Life OS utiliza migraciones y reparaciones idempotentes en los casos donde una instalación antigua necesita incorporar nuevas columnas o estructuras.

## Pruebas

El proyecto cuenta con pruebas automatizadas para diferentes partes de la aplicación.

Después de modificar una función se debe validar, como mínimo:

```powershell
python -m compileall .
```

Y ejecutar la suite de pruebas disponible en el proyecto.

Para JavaScript también es recomendable validar la sintaxis de `static/app.js` antes de desplegar una nueva versión.

## Principios de mantenimiento

Kevin Life OS es un sistema personal de largo plazo y contiene datos que no deben tratarse como información temporal.

Por eso, cada cambio debe respetar estas reglas:

- mantener compatibilidad con los datos existentes;
- no modificar módulos que no formen parte de la solicitud actual;
- conservar rutas, formatos y comportamiento existente cuando no sea necesario cambiarlos;
- evitar registros duplicados o estados parciales entre módulos relacionados;
- validar tanto la lógica local como sus dependencias;
- actualizar PROJECT CONTINUITY PROTOCOL cuando una nueva versión cambia el comportamiento del sistema.

## Estado actual

La versión actual es **V178**.

Entre las reglas más recientes del sistema se encuentran:

- las Daily Activities dependen realmente de los elementos activos en Focus;
- pueden existir hasta dos Focus simultáneos;
- English conserva su misión y lógica propia dentro de Language Hunter y no genera una misión Study duplicada;
- Recovery representa una actividad una sola vez aunque esa actividad contribuya a varios hábitos;
- el sistema financiero mantiene sincronizados compras, cuotas, tarjetas y obligaciones mensuales;
- las operaciones de rediferido individual y refinanciación global se mantienen como procesos independientes.

## Uso personal

Kevin Life OS fue creado como una herramienta personal y evoluciona a partir de necesidades reales de uso. No pretende ser una plantilla genérica ni un producto terminado para terceros.

La prioridad del proyecto es conservar la información, mantener coherencia entre módulos y permitir que nuevas funciones se incorporen sin romper comportamientos que ya forman parte del flujo diario.
