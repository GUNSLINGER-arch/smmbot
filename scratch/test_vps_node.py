import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

node_cmd = """
node -e "
const { execFile } = require('child_process');
const path = require('path');
const scraperPath = path.join('/home/arham/smmbot', 'scraper.py');
execFile('python3', [scraperPath, 'https://www.tiktok.com/@saith_abid/video/7663358917363207444', 'TikTok', ''], (err, stdout, stderr) => {
  console.log('NODE EXEC STDOUT:', stdout);
  console.log('NODE EXEC STDERR:', stderr);
  console.log('NODE EXEC ERR:', err);
});
"
"""

stdin, stdout, stderr = ssh.exec_command(node_cmd)
print("OUT:", stdout.read().decode())
print("ERR:", stderr.read().decode())
ssh.close()
