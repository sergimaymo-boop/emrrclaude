#!/bin/bash
# Sincroniza el script del informe semanal de Rally Leaders con la copia del repo.
# Mismo motivo que en CarteraIBK: launchd NO puede ejecutar un script del Escritorio
# (TCC de macOS lo bloquea con "Operation not permitted"), así que el que corre de
# verdad vive en Application Support. Ejecutar esto DESPUÉS de tocar el del repo.
set -e
DEST_DIR="$HOME/Library/Application Support/RallyWeekly/bin"
mkdir -p "$DEST_DIR"
cp "$(dirname "$0")/rally_weekly_report.py" "$DEST_DIR/rally_weekly_report.py"
echo "sincronizado → $DEST_DIR/rally_weekly_report.py"
