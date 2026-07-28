import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

cmd = 'python3 /home/arham/smmbot/scraper.py "https://www.tiktok.com/@saith_abid/video/7663358917363207444" "TikTok" ""'
stdin, stdout, stderr = ssh.exec_command(cmd)
print("SCRAPER DIRECT OUTPUT:", stdout.read().decode())
ssh.close()
