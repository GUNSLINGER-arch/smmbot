import sys
import subprocess
import time
import json

def run_ssh():
    # Try using sshpass if available or interactive pexpect/subprocess
    vps_ip = "74.162.122.198"
    user = "arham"
    password = "Barracuda7200@"
    
    print(f"Connecting to {user}@{vps_ip}...")
    
    # Try paramiko first
    try:
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(vps_ip, username=user, password=password, timeout=15)
        
        cmd = "cd smmbot && git pull origin main && pm2 restart smmbot-backend"
        stdin, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode('utf-8')
        err = stderr.read().decode('utf-8')
        
        print("STDOUT:", out)
        print("STDERR:", err)
        ssh.close()
        return True
    except Exception as e:
        print(f"Paramiko failed: {e}")
        
    return False

if __name__ == "__main__":
    run_ssh()
