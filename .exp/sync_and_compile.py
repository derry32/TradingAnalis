#!/usr/bin/env python3
import pexpect
import sys
import time

def main():
    print("=== 1. Uploading mq5 to server ===")
    child = pexpect.spawn("scp -o StrictHostKeyChecking=no ./mt5/AurumAI_Executor.mq5 ubuntu@43.156.79.235:/tmp/AurumAI_Executor.mq5", timeout=30)
    idx = child.expect(["password:", pexpect.EOF])
    if idx == 0:
        child.sendline("thunder-29%-quantum")
        child.expect(pexpect.EOF)
    print("Uploaded to /tmp/AurumAI_Executor.mq5")

    print("=== 2. Connecting via SSH ===")
    ssh = pexpect.spawn("ssh -o StrictHostKeyChecking=no ubuntu@43.156.79.235", timeout=45)
    ssh.expect("password:")
    ssh.sendline("thunder-29%-quantum")
    ssh.expect(r"\$ ")

    print("=== 3. Copying to MT5 Experts directory ===")
    ssh.sendline("sudo docker cp /tmp/AurumAI_Executor.mq5 ai-mt5-vnc:'/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/AurumAI_Executor.mq5'")
    ssh.expect(r"\$ ")

    print("=== 4. Checking file content around line 88 ===")
    ssh.sendline("sudo docker exec ai-mt5-vnc sed -n '85,95p' '/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/AurumAI_Executor.mq5'")
    ssh.expect(r"\$ ")
    print(ssh.before.decode())

    print("=== 5. Restarting MetaEditor with file and compiling ===")
    ssh.sendline("sudo docker exec ai-mt5-vnc pkill -9 -f MetaEditor64.exe || true")
    ssh.expect(r"\$ ")
    time.sleep(1)

    ssh.sendline("sudo docker exec -u kasm-user -d -e DISPLAY=:1 -e WINEPREFIX=/headless/.wine ai-mt5-vnc wine '/headless/.wine/drive_c/Program Files/MetaTrader 5/MetaEditor64.exe' 'C:\\Program Files\\MetaTrader 5\\MQL5\\Experts\\AurumAI_Executor.mq5'")
    ssh.expect(r"\$ ")
    time.sleep(6)

    cmd = (
        "sudo docker exec -u kasm-user -e DISPLAY=:1 ai-mt5-vnc bash -c '"
        "WID=$(xdotool search --onlyvisible --class metaeditor | head -1); "
        "xdotool windowactivate --sync $WID; "
        "sleep 1; "
        "xdotool key F7; "
        "sleep 4; "
        "xdotool mousemove 600 650 click 1; "
        "sleep 0.5; "
        "xdotool key ctrl+a; "
        "sleep 0.5; "
        "xdotool key ctrl+c; "
        "sleep 0.5; "
        "echo \"=== CLIPBOARD MESSAGES ===\"; "
        "xclip -o -selection clipboard; '"
    )
    ssh.sendline(cmd)
    ssh.expect(r"\$ ", timeout=30)
    print(ssh.before.decode())

    print("=== 6. Checking MetaEditor compile log ===")
    ssh.sendline("sudo docker exec ai-mt5-vnc iconv -f UTF-16LE -t UTF-8 '/headless/.wine/drive_c/Program Files/MetaTrader 5/logs/metaeditor.log' | tail -n 5")
    ssh.expect(r"\$ ")
    print(ssh.before.decode())

    print("=== 7. Listing Experts directory ===")
    ssh.sendline("sudo docker exec ai-mt5-vnc ls -la '/headless/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts/'")
    ssh.expect(r"\$ ")
    print(ssh.before.decode())

    ssh.sendline("exit")
    ssh.expect(pexpect.EOF)
    print("Done!")

if __name__ == "__main__":
    main()
