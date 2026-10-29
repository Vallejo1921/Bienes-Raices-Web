#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8782}"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'Error: se requiere python3 para iniciar el servidor local.\n' >&2
  exit 1
fi

if ! python3 - "$PORT" <<'PY'
import socket
import sys

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    sock.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
then
  printf 'El puerto %s ya está ocupado. No se detuvo ningún proceso ajeno.\n' "$PORT" >&2
  printf 'Cierra ese proceso o ejecuta PORT=otro_puerto ./start.sh\n' >&2
  exit 1
fi

printf 'ADAHRA Bienes Raíces · previsualización pública\n'
printf 'Página pública: http://127.0.0.1:%s/index.html\n' "$PORT"
printf 'Carpeta:        %s\n' "$PWD"
printf '\n'
printf 'La web lee data/properties.json sin backend. Para editar el catálogo\n'
printf 'usa ./start-admin.sh (editor local) y publica con Git.\n'
printf 'Servidor en primer plano. Pulsa Ctrl+C para detenerlo.\n\n'

exec python3 -m http.server "$PORT" --bind 127.0.0.1
