#!/bin/bash
# Sincroniza el script del agente CarteraIBK con la copia versionada del repo.
# El agente NO puede ejecutar el del Escritorio (TCC de macOS lo bloquea), así que
# vive en Application Support. Ejecutar esto después de tocar el script del repo.
set -e
DEST="$HOME/Library/Application Support/CarteraIBK/bin/cartera_ibk_export.py"
cp "$(dirname "$0")/cartera_ibk_export.py" "$DEST"
echo "sincronizado → $DEST"
