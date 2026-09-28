"""
ASO Analyzer – local proxy server
Runs on http://localhost:3131
Usage: python proxy.py
"""
import http.server
import urllib.request
import urllib.parse
import json
import ssl
import sys

PORT = 3131

SSL_CTX = ssl.create_default_context()

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/125.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}


class ProxyHandler(http.server.BaseHTTPRequestHandler):

    def send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if 'url' not in params:
            self.send_response(400)
            self.send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"Missing url param"}')
            return

        target = params['url'][0]
        print(f'  Fetching: {target[:80]}')

        try:
            req = urllib.request.Request(target, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as resp:
                content = resp.read()
                ct = resp.headers.get('Content-Type', 'text/html; charset=utf-8')

            self.send_response(200)
            self.send_cors()
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            print(f'  OK: {len(content)} bytes')

        except urllib.error.HTTPError as e:
            body = json.dumps({'error': f'HTTP {e.code}: {e.reason}'}).encode()
            self.send_response(e.code)
            self.send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)
            print(f'  HTTP error: {e.code}')

        except Exception as e:
            body = json.dumps({'error': str(e)}).encode()
            self.send_response(502)
            self.send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)
            print(f'  Error: {e}')

    def log_message(self, fmt, *args):
        pass  # handled in do_GET


if __name__ == '__main__':
    try:
        server = http.server.HTTPServer(('localhost', PORT), ProxyHandler)
    except OSError:
        print(f'Port {PORT} already in use. Is proxy.py already running?')
        sys.exit(1)

    print(f'ASO Proxy listening on http://localhost:{PORT}')
    print('Keep this window open while using ASO Analyzer.')
    print('Press Ctrl+C to stop.\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
