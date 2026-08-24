#!/usr/bin/env python3
import subprocess
import time
import sys

def test_code(code_str, test_name):
    # Write to local file
    with open("mt5/test_probe.mq5", "w") as f:
        f.write(code_str)
    
    # Run sync and compile expect script
    script = """#!/usr/bin/expect -f
set timeout 60
spawn scp -o StrictHostKeyChecking=no ./mt5/test_probe.mq5 ubuntu@43.156.79.235:/tmp/test_probe.mq5
expect "password:"
send "thunder-29%-quantum\\r"
expect eof

spawn ssh -o StrictHostKeyChecking=no ubuntu@43.156.79.235
expect "password:"
send "thunder-29%-quantum\\r"
expect "$ "

send "sudo docker cp /tmp/test_probe.mq5 ai-mt5-vnc:'/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/test_probe.mq5'\\r"
expect "$ "

send "sudo docker exec -u kasm-user -e DISPLAY=:1 ai-mt5-vnc bash -c '
WID=\\$(xdotool search --onlyvisible --class metaeditor | head -1)
xdotool windowactivate --sync \\$WID
sleep 0.5
xdotool key ctrl+o
sleep 1
xdotool key ctrl+a
sleep 0.5
xdotool type \"C:\\\\Program Files\\\\MetaTrader 5\\\\MQL5\\\\Experts\\\\test_probe.mq5\"
sleep 1
xdotool key Return
sleep 2
xdotool key F7
sleep 3
xdotool mousemove 600 650 click 1
sleep 0.5
xdotool key ctrl+a
sleep 0.5
xdotool key ctrl+c
sleep 0.5
echo === CLIPBOARD ===
xclip -o -selection clipboard
'\\r"
expect "$ "

send "sudo docker exec ai-mt5-vnc ls -la '/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/test_probe.ex5' || true\\r"
expect "$ "

send "exit\\r"
expect eof
"""
    with open(".exp/probe.exp", "w") as f:
        f.write(script)
    
    res = subprocess.run(["expect", ".exp/probe.exp"], capture_output=True, text=True)
    out = res.stdout
    print(f"=== TEST: {test_name} ===")
    if "test_probe.ex5" in out:
        print(">>> SUCCESS: test_probe.ex5 GENERATED! <<<")
        return True
    else:
        # Extract clipboard messages
        cb_idx = out.find("=== CLIPBOARD ===")
        if cb_idx != -1:
            print("Compiler error:", out[cb_idx:cb_idx+300])
        else:
            print("Output tail:", out[-300:])
        return False

# Test 1: Full file
with open("mt5/AurumAI_Executor.mq5", "r") as f:
    full_code = f.read()

test_code(full_code, "Full AurumAI_Executor")
