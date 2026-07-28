const paramiko = require('child_process');
const fs = require('fs');

const pythonScript = `
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

# Execute node test script on VPS directly inside /home/arham/smmbot
cmd = 'node -e "const { fetchLiveMetadata } = require(\'./server.js\'); fetchLiveMetadata(\'https://www.tiktok.com/@saith_abid/video/7663358917363207444\', \'TikTok\').then(m => console.log(JSON.stringify(m)))"'
stdin, stdout, stderr = ssh.exec_command(cmd)
print("NODE TEST STDOUT:", stdout.read().decode())
print("NODE TEST STDERR:", stderr.read().decode())
ssh.close()
`;

fs.writeFileSync('scratch/test_vps_node.py', pythonScript);
