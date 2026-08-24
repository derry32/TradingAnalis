#!/usr/bin/env python3
import subprocess

def test_file_content(content, label):
    with open("mt5/test_probe.mq5", "w") as f:
        f.write(content)
    
    cmd = """#!/usr/bin/expect -f
set timeout 45
spawn scp -o StrictHostKeyChecking=no ./mt5/test_probe.mq5 ubuntu@43.156.79.235:/tmp/
expect "password:"
send "thunder-29%-quantum\\r"
expect eof

spawn ssh -o StrictHostKeyChecking=no ubuntu@43.156.79.235
expect "password:"
send "thunder-29%-quantum\\r"
expect "$ "

send "sudo docker cp /tmp/test_probe.mq5 ai-mt5-vnc:'/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/test_probe.mq5'\\r"
expect "$ "

send "sudo /tmp/remote_compile.sh test_probe.mq5\\r"
expect "$ "

send "exit\\r"
expect eof
"""
    with open(".exp/run_bisect.exp", "w") as f:
        f.write(cmd)
    
    res = subprocess.run(["expect", ".exp/run_bisect.exp"], capture_output=True, text=True)
    out = res.stdout
    success = "test_probe.ex5" in out and "ls: cannot access" not in out.split("=== EX5 CHECK ===")[-1]
    print(f"[{label}] -> {'SUCCESS (EX5 GENERATED!)' if success else 'FAILED'}")
    if not success:
        cb = out.find("=== CLIPBOARD RESULT ===")
        if cb != -1:
            print(out[cb:cb+150])
    return success

# Let's test a simple minimal valid MQL5 EA first:
minimal = """
#property copyright "Aurum AI"
#property version "1.00"

int OnInit() { return(INIT_SUCCEEDED); }
void OnDeinit(const int reason) {}
void OnTick() {}
"""
test_file_content(minimal, "Minimal EA Test")
