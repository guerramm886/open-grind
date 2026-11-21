# Martins Grindr

open-grind como página web. Este complemento corre el mismo cliente de Grindr
que la app de Android, desde esta PC, y sirve la página.

## Antes de abrirla

1. En **Configuración** de este complemento, poné una **clave de acceso** en
   `password` y guardá. Sin clave, cualquiera en tu WiFi puede entrar.
2. Reiniciá el complemento.
3. Abrí `http://<ip-de-esta-PC>:8099` desde un navegador en tu casa.

## Dónde quedan los datos

En la carpeta de datos del complemento (`/data`), que entra en las copias de
seguridad de Home Assistant:

- `secrets/`: la sesión de Grindr (no se muestra en la página).
- `app-data/`: frases, ajustes, notas y marcas, un archivo por cada uno.
