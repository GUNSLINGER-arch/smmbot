import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("74.162.122.198", username="arham", password="Barracuda7200@")

cmd = '''python3 -c "
import yt_dlp
opts = {
    'quiet': True,
    'skip_download': True,
    'http_headers': {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
    }
}
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info('https://www.tiktok.com/@saith_abid/video/7663358917363207444', download=False)
    print('TITLE:', info.get('title'))
    print('VIEW_COUNT:', info.get('view_count'))
    print('LIKE_COUNT:', info.get('like_count'))
    print('COMMENT_COUNT:', info.get('comment_count'))
    print('REPOST_COUNT:', info.get('repost_count'))
"'''

stdin, stdout, stderr = ssh.exec_command(cmd)
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
ssh.close()
