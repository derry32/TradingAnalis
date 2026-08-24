#!/usr/bin/env python3
import sys
import time
import subprocess

PASS = "thunder-29%-quantum"
HOST = "ubuntu@43.156.79.235"

def run_ssh(cmd):
    full_cmd = f"ssh -o StrictHostKeyChecking=no {HOST} '{cmd}'"
    print(f"\n>>> Running: {cmd}")
    proc = subprocess.Popen(
        ["sshpass", "-p", PASS, "ssh", "-o", "StrictHostKeyChecking=no", HOST, cmd],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )
    out, _ = proc.communicate()
    print(out)
    return out

def run_scp(src, dst):
    print(f"\n>>> SCP: {src} -> {dst}")
    subprocess.run(["sshpass", "-p", PASS, "scp", "-o", "StrictHostKeyChecking=no", src, f"{HOST}:{dst}"])

def main():
    # 1. SCP modified backend files
    files = [
        "backend/src/index.ts",
        "backend/src/services/featureEngine.ts",
        "backend/src/services/confidenceEngine.ts",
        "backend/src/services/signalStateMachine.ts",
        "backend/src/services/marketDataService.ts",
        "backend/src/services/mt5Bridge.ts"
    ]
    for f in files:
        run_scp(f, f"/home/ubuntu/TradingAnalis/{f}")

    # 2. SCP MQ5
    run_scp("mt5/AurumAI_Executor.mq5", "/tmp/AurumAI_Executor.mq5")

    # 3. Build backend in docker container
    cmd_backend = """
    echo PASS | sudo -S docker exec ai-backend npm run build || true
    echo PASS | sudo -S docker restart ai-backend
    """.replace("PASS", PASS)
    run_ssh(cmd_backend)

    # 4. Copy MQ5 to MT5 container and compile with MetaEditor
    cmd_compile = """
    echo PASS | sudo -S docker cp /tmp/AurumAI_Executor.mq5 ai-mt5-vnc:'/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/AurumAI_Executor.mq5'
    echo PASS | sudo -S docker exec ai-mt5-vnc pkill -9 -f MetaEditor64.exe || true
    sleep 1
    echo PASS | sudo -S docker exec -u kasm-user -d -e DISPLAY=:1 -e WINEPREFIX=/headless/.wine ai-mt5-vnc wine '/headless/.wine/drive_c/Program Files/MetaTrader 5/MetaEditor64.exe' 'C:\\Program Files\\MetaTrader 5\\MQL5\\Experts\\AurumAI_Executor.mq5'
    sleep 6
    echo PASS | sudo -S docker exec -u kasm-user -e DISPLAY=:1 ai-mt5-vnc bash -c 'WID=$(xdotool search --onlyvisible --class metaeditor | head -1); xdotool windowactivate --sync $WID; sleep 1; xdotool key F7; sleep 4;'
    echo "=== COMPILATION RESULT ==="
    echo PASS | sudo -S docker exec ai-mt5-vnc iconv -f UTF-16LE -t UTF-8 '/headless/.wine/drive_c/Program Files/MetaTrader 5/logs/metaeditor.log' | tail -n 8
    """.replace("PASS", PASS)
    run_ssh(cmd_compile)

    # 5. Restart MT5 terminal to attach v4.20 EA
    cmd_restart_mt5 = """
    echo PASS | sudo -S docker exec ai-mt5-vnc pkill -9 -f terminal64.exe || true
    sleep 2
    echo PASS | sudo -S docker exec -u kasm-user -d -e DISPLAY=:1 -e WINEPREFIX=/headless/.wine ai-mt5-vnc wine '/headless/.wine/drive_c/Program Files/MetaTrader 5/terminal64.exe'
    sleep 8
    echo "=== EXPERTS LOG VERIFICATION ==="
    today=$(date +%Y%m%d)
    echo PASS | sudo -S docker exec ai-mt5-vnc iconv -f UTF-16LE -t UTF-8 "/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Logs/$today.log" 2>/dev/null | tail -n 25 || true
    """.replace("PASS", PASS)
    run_ssh(cmd_restart_mt5)

if __name__ == "__main__":
    main()
