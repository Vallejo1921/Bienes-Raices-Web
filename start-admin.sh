#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8783}"
HOST="${HOST:-0.0.0.0}"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'Error: se requiere python3 para iniciar el editor local.\n' >&2
  exit 1
fi

if ! python3 - "$PORT" "$HOST" <<'PY'
import socket
import sys

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    sock.bind((sys.argv[2], int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
then
  printf 'El puerto %s ya está ocupado. No se detuvo ningún proceso ajeno.\n' "$PORT" >&2
  printf 'Cierra ese proceso o ejecuta PORT=otro_puerto ./start-admin.sh\n' >&2
  exit 1
fi

printf 'ADAHRA Bienes Raíces · editor local de propiedades\n'
printf 'Editor:  http://%s:%s/admin.html\n' "$HOST" "$PORT"
printf 'Público: http://%s:%s/index.html\n' "$HOST" "$PORT"
printf 'Carpeta: %s\n' "$PWD"
printf '\n'
printf 'Este servidor escucha sólo en %s. El editor no escribe en Internet:\n' "$HOST"
printf 'exporta properties.json y publica el cambio con Git.\n'
printf 'Servidor en primer plano. Pulsa Ctrl+C para detenerlo.\n\n'

exec python3 -m http.server "$PORT" --bind "$HOST"
