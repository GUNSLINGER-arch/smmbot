import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

cmd = '''cd /home/arham/smmbot && node -e "
const { execFile } = require('child_process');
const path = require('path');
const scraperPath = path.join(__dirname, 'scraper.py');
execFile('python3', [scraperPath, 'https://www.tiktok.com/@saith_abid/video/7663358917363207444', 'TikTok', ''], { timeout: 25000 }, (err, stdout, stderr) => {
  console.log('NODE STDOUT:', stdout);
  console.log('NODE STDERR:', stderr);
});
"'''

stdin, stdout, stderr = ssh.exec_command(cmd)
print("NODE TEST STDOUT:", stdout.read().decode())
print("NODE TEST STDERR:", stderr.read().decode())
ssh.close()
