"""Local dev server that mimics vercel.json's rewrites.

Run from the repo root:  python devserver.py  [port]
Then open http://localhost:8000

Static only — /api/* serverless functions are NOT run (the timetable panel
reads /db/timetables/*.json, so it works without them; Free Rooms' C/D sheet
sync will log a console warning and fall back).
"""
import http.server
import os
import posixpath
import sys
import urllib.parse

ROOT = os.getcwd()

# source prefix -> destination prefix (mirrors vercel.json "rewrites")
PREFIXES = [
    ("/css/", "/web/css/"),
    ("/js/", "/web/js/"),
    ("/components/", "/web/components/"),
    ("/modals/", "/web/modals/"),
    ("/assets/", "/web/assets/"),
    ("/icons/", "/web/icons/"),
]
EXACT = {
    "/": "/web/index.html",
    "/manifest.json": "/web/manifest.json",
    "/service-worker.js": "/web/service-worker.js",
    "/robots.txt": "/web/robots.txt",
    "/sitemap.xml": "/web/sitemap.xml",
}


def rewrite(path):
    if path in EXACT:
        return EXACT[path]
    for src, dst in PREFIXES:
        if path.startswith(src):
            return dst + path[len(src):]
    # /db/** already lives at its real path on disk; leave it alone.
    if path.startswith("/db/"):
        return path
    if os.path.exists(os.path.join(ROOT, path.lstrip("/").replace("/", os.sep))):
        return path
    return "/web/index.html"  # SPA catch-all


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path).path
        parsed = urllib.parse.unquote(parsed)
        target = rewrite(posixpath.normpath(parsed))
        return os.path.join(ROOT, target.lstrip("/").replace("/", os.sep))

    def end_headers(self):
        # Always serve fresh files so an edit shows up on reload.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving {ROOT} on http://localhost:{port}  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
# talha khusro ghaus was here