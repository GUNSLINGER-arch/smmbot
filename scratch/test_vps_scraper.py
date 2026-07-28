import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

# Test 1: with empty proxy argument
cmd1 = 'python3 /home/arham/smmbot/scraper.py "https://www.tiktok.com/@saith_abid/video/7663358917363207444" "TikTok" ""'
stdin, stdout, stderr = ssh.exec_command(cmd1)
print("TEST 1 STDOUT:", stdout.read().decode())
print("TEST 1 STDERR:", stderr.read().decode())

# Test 2: direct python command with 2 args
cmd2 = 'python3 /home/arham/smmbot/scraper.py "https://www.tiktok.com/@saith_abid/video/7663358917363207444" "TikTok"'
stdin, stdout, stderr = ssh.exec_command(cmd2)
print("TEST 2 STDOUT:", stdout.read().decode())
print("TEST 2 STDERR:", stderr.read().decode())

ssh.close()
