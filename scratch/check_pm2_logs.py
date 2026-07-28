import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

cmd = "pm2 logs smmbot-backend --lines 30 --nostream"
stdin, stdout, stderr = ssh.exec_command(cmd)
print("PM2 LOGS STDOUT:\n", stdout.read().decode())
print("PM2 LOGS STDERR:\n", stderr.read().decode())
ssh.close()
