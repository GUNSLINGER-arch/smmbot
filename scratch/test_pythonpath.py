import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

cmd = "PYTHONPATH=/home/arham/.local/lib/python3.12/site-packages python3 /home/arham/smmbot/scraper.py 'https://www.tiktok.com/@saith_abid/video/7663358917363207444' 'TikTok' ''"
stdin, stdout, stderr = ssh.exec_command(cmd)
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
ssh.close()
