#!/bin/bash
# Sincroniza el vigilante de patrimonio con la copia del repo.
# Mismo motivo que en CarteraIBK y RallyWeekly: launchd NO puede ejecutar un script
# del Escritorio (TCC de macOS lo bloquea). Ejecutar DESPUÉS de tocar el del repo.
set -e
DEST_DIR="$HOME/Library/Application Support/NavAlert/bin"
mkdir -p "$DEST_DIR"
cp "$(dirname "$0")/nav_alert.py" "$DEST_DIR/nav_alert.py"
chmod +x "$DEST_DIR/nav_alert.py"
echo "sincronizado → $DEST_DIR/nav_alert.py"
