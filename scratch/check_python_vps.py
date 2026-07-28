import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

cmd = "which python3 && which python && python3 -c 'import yt_dlp; print(yt_dlp.__file__)'"
stdin, stdout, stderr = ssh.exec_command(cmd)
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
ssh.close()
