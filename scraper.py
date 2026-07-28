import sys
import json
import re
import os

def parse_count(s):
    if not s: return 0
    s = str(s).replace(',', '').strip().upper()
    mult = 1
    if s.endswith('K'):
        mult = 1000
        s = s[:-1]
    elif s.endswith('M'):
        mult = 1000000
        s = s[:-1]
    elif s.endswith('B'):
        mult = 1000000000
        s = s[:-1]
    try:
        return int(float(s) * mult)
    except:
        return 0

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing args"}))
        return
    url = sys.argv[1]
    platform = sys.argv[2]
    proxy_url = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3].strip() else None
    
    meta = {}
    
    # Try Instagram via instaloader if available
    if platform == "Instagram" or "instagram.com" in url:
        try:
            import instaloader
            L = instaloader.Instaloader(quiet=True, download_pictures=False, download_videos=False, download_video_thumbnails=False, compress_json=False, save_metadata=False)
            if proxy_url:
                L.context._session.proxies = {
                    'http': proxy_url,
                    'https': proxy_url
                }
            cookie_file = "instagram_cookies.txt"
            if not os.path.exists(cookie_file):
                cookie_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instagram_cookies.txt")
            
            if os.path.exists(cookie_file):
                import http.cookiejar
                import io
                with open(cookie_file, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                cleaned_lines = [l[len("#HttpOnly_"):] if l.startswith("#HttpOnly_") else l for l in lines]
                cj = http.cookiejar.MozillaCookieJar()
                cj._really_load(io.StringIO("".join(cleaned_lines)), cookie_file, ignore_discard=True, ignore_expires=True)
                L.context._session.cookies.update(cj)
            
            m = re.search(r'/(?:reel|p|tv)/([A-Za-z0-9_-]+)/?', url)
            if m:
                shortcode = m.group(1)
                post = instaloader.Post.from_shortcode(L.context, shortcode)
                meta = {
                    "views": post.video_view_count if post.is_video else None,
                    "likes": post.likes,
                    "comments": post.comments,
                    "shares": getattr(post, 'share_count', None),
                    "saves": None,
                    "title": (post.caption or '').split('\n')[0][:120],
                    "author": post.owner_username,
                    "source": "instaloader"
                }
        except Exception as e:
            pass
 
    # Try yt-dlp fallback for both TikTok and Instagram (Scrapes Views, Likes, Comments, Shares, Saves)
    if not meta.get("title"):
        try:
            import yt_dlp
            opts = {'quiet': True, 'no_warnings': True, 'skip_download': True}
            if proxy_url:
                opts['proxy'] = proxy_url
            
            # Try passing browser cookies
            for browser in ['edge', 'chrome', 'firefox', 'brave', 'chromium']:
                try:
                    opts_cookie = {**opts, 'cookiesfrombrowser': (browser,)}
                    with yt_dlp.YoutubeDL(opts_cookie) as ydl:
                        info = ydl.extract_info(url, download=False)
                    if info and info.get('title'):
                        meta = {
                            'title': info.get('title', ''),
                            'author': info.get('uploader') or info.get('channel', ''),
                            'views': info.get('view_count'),
                            'likes': info.get('like_count'),
                            'comments': info.get('comment_count'),
                            'shares': info.get('repost_count') or info.get('share_count'),
                            'saves': info.get('bookmark_count') or info.get('save_count'),
                            'source': f'yt-dlp ({browser})'
                        }
                        break
                except:
                    continue
            
            if not meta.get("title"):
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                if info and info.get('title'):
                    meta = {
                        'title': info.get('title', ''),
                        'author': info.get('uploader') or info.get('channel', ''),
                        'views': info.get('view_count'),
                        'likes': info.get('like_count'),
                        'comments': info.get('comment_count'),
                        'shares': info.get('repost_count') or info.get('share_count'),
                        'saves': info.get('bookmark_count') or info.get('save_count'),
                        'source': 'yt-dlp'
                    }
        except Exception as e:
            pass
            
    print(json.dumps(meta))

if __name__ == "__main__":
    main()
