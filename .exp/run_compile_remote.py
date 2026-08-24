#!/usr/bin/env python3
import subprocess

REMOTE_SCRIPT = """
sudo docker exec ai-mt5-vnc pkill -9 -f metaeditor64.exe || true
sleep 1
sudo docker exec -u kasm-user -d -e DISPLAY=:1 -e WINEPREFIX=/headless/.wine ai-mt5-vnc wine '/headless/.wine/drive_c/Program Files/MetaTrader 5/metaeditor64.exe' 'C:\\Program Files\\MetaTrader 5\\MQL5\\Experts\\AurumAI_Executor.mq5'
sleep 4
sudo docker exec -u kasm-user -e DISPLAY=:1 ai-mt5-vnc xdotool key F7
sleep 3
sudo docker exec ai-mt5-vnc iconv -f UTF-16LE -t UTF-8 '/headless/.wine/drive_c/Program Files/MetaTrader 5/logs/metaeditor.log' | tail -n 6
sudo docker exec ai-mt5-vnc ls -la '/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/'
"""

import pexpect

child = pexpect.spawn('ssh -o StrictHostKeyChecking=no ubuntu@43.156.79.235', timeout=60, encoding='utf-8')
child.expect(['password:', pexpect.EOF])
child.sendline('thunder-29%-quantum')
child.expect(['$', '#'])

for line in REMOTE_SCRIPT.strip().split('\n'):
    if line.strip():
        child.sendline(line)
        child.expect(['$', '#'])
        print(child.before)

child.sendline('exit')
child.expect(pexpect.EOF)
print("Done!")
