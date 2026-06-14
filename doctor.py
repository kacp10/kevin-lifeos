# -*- coding: utf-8 -*-
"""
DOCTOR del Life OS — revisa tu instalación y te dice qué está mal.
Ponlo DENTRO de la carpeta lifeos_web y corre:  python doctor.py
"""
import os
import json
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
OK, BAD = '  [OK] ', '  [X]  '
problemas = []


def revisar(ruta, marcadores, nombre):
    p = os.path.join(BASE, ruta)
    if not os.path.exists(p):
        print(BAD + f'{ruta} NO EXISTE en esa carpeta.')
        problemas.append(f'Falta {ruta}: el archivo nuevo "{nombre}" debe ir exactamente en {ruta}')
        return
    with open(p, encoding='utf-8', errors='ignore') as f:
        contenido = f.read()
    viejos = [m for m in marcadores if m not in contenido]
    if viejos:
        print(BAD + f'{ruta} existe pero es la VERSIÓN VIEJA (no tiene: {", ".join(viejos)}).')
        problemas.append(f'Reemplaza {ruta} por el archivo nuevo que te dio Claude')
    else:
        print(OK + f'{ruta} es la versión nueva ✔')


print('\n========= DOCTOR LIFE OS =========\n')
print('1) Revisando archivos y sus carpetas...\n')
revisar('app.py', ["'/api/debt/new'", 'VERSION = 15'], 'app.py')
revisar('templates/index.html', ['debtNew', 'checkServicios', 'app.js?v=15'], 'index.html')
revisar('static/app.js', ['debtNew', 'monthKey', 'FRONT_V = 15'], 'app.js')
revisar('static/style.css', ['check-item', 'desglose'], 'style.css')
revisar('seed_data.json', ['servicios', 'detalle'], 'seed_data.json')

# trampas comunes: archivos sueltos en la raíz que deberían estar en subcarpetas
print('\n2) Buscando archivos en el lugar equivocado...\n')
trampas = False
for nombre, debe in [('index.html', 'templates'), ('app.js', 'static'), ('style.css', 'static')]:
    if os.path.exists(os.path.join(BASE, nombre)):
        print(BAD + f'Hay un "{nombre}" suelto en la raíz: Flask lo IGNORA. Muévelo a la carpeta {debe}/')
        problemas.append(f'Mueve {nombre} de la raíz a la carpeta {debe}/')
        trampas = True
if not trampas:
    print(OK + 'Ningún archivo perdido en la raíz ✔')

print('\n3) Revisando el servidor...\n')
try:
    r = urllib.request.urlopen('http://localhost:5000/api/ping', timeout=3)
    v = json.load(r).get('version')
    if v == 15:
        print(OK + 'El servidor está corriendo Y es la versión nueva (v15) ✔')
    else:
        print(BAD + f'El servidor responde pero con versión {v}.')
        problemas.append('Reinicia el servidor: Ctrl+C en la terminal y de nuevo: python app.py')
except urllib.error.HTTPError:
    print(BAD + 'El servidor corre pero con el app.py VIEJO (no conoce /api/ping).')
    problemas.append('Reinicia el servidor: Ctrl+C y de nuevo: python app.py (con el app.py nuevo ya en la carpeta)')
except Exception:
    print(BAD + 'El servidor NO está corriendo en http://localhost:5000.')
    problemas.append('Arranca el servidor: abre la terminal en esta carpeta y corre: python app.py')

print('\n========= DIAGNÓSTICO =========\n')
if not problemas:
    print('  ✦ TODO PERFECTO. Si el navegador aún se porta raro: Ctrl+F5.')
    print('  ✦ Y entra siempre por http://localhost:5000 (no abras el index.html con doble clic).\n')
else:
    print('  Haz esto, en orden:\n')
    for i, p in enumerate(dict.fromkeys(problemas), 1):
        print(f'  {i}. {p}')
    print('\n  Cuando termines, corre otra vez: python doctor.py\n')
