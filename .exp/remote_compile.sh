#!/bin/bash
set -e

# Target mq5 file passed as $1
FILE="${1:-AurumAI_Executor.mq5}"

# Kill previous metaeditor
docker exec ai-mt5-vnc pkill -9 -f MetaEditor64.exe || true
sleep 1

# Launch metaeditor with the file from MT5 directory
docker exec -u kasm-user -d -e DISPLAY=:1 -e WINEPREFIX=/headless/.wine ai-mt5-vnc bash -c "cd '/headless/.wine/drive_c/Program Files/MetaTrader 5' && wine metaeditor64.exe 'MQL5/Experts/$FILE'"

# Wait for UI to render
sleep 5

# Focus editor, press F7, copy clipboard
docker exec -u kasm-user -e DISPLAY=:1 ai-mt5-vnc bash -c '
WID=$(xdotool search --onlyvisible --class metaeditor | head -1)
xdotool windowactivate --sync $WID
sleep 1
# Focus code editor
xdotool mousemove 750 300 click 1
sleep 0.5
xdotool key F7
sleep 3
# Click errors list
xdotool mousemove 600 650 click 1
sleep 0.5
xdotool key ctrl+a
sleep 0.5
xdotool key ctrl+c
sleep 0.5
echo "=== CLIPBOARD RESULT ==="
xclip -o -selection clipboard || true
'

echo "=== LOG OUTPUT ==="
docker exec ai-mt5-vnc iconv -f UTF-16LE -t UTF-8 "/headless/.wine/drive_c/Program Files/MetaTrader 5/logs/metaeditor.log" | tail -n 5

echo "=== EX5 CHECK ==="
BASENAME="${FILE%.*}"
docker exec ai-mt5-vnc ls -la "/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/$BASENAME.ex5" || echo "EX5 NOT FOUND"
