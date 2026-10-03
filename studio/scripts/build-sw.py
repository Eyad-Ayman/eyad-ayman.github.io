#!/usr/bin/env python3
"""Regenerate studio/sw.js after changing Studio files.

Run from anywhere:  python3 studio/scripts/build-sw.py
It lists every Studio file for the offline cache and bumps the cache version
(hash of all file contents), so installed copies update cleanly.
"""
import hashlib, json, os, re
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = []
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d not in ('scripts',)]
    for f in fn:
        rel = os.path.relpath(os.path.join(dp, f), root).replace(os.sep, '/')
        if rel in ('sw.js',) or rel.endswith(('.md', '.txt')):
            continue
        # large on-demand AI runtime/models: cached at first use instead of precached
        # (the offline pack in Settings caches these after install)
        if rel.startswith(('vendor/mediapipe/', 'vendor/onnxruntime-web/', 'vendor/three/', 'vendor/pdfjs/', 'vendor/fzstd/', 'vendor/kiwi/')):
            continue
        full = os.path.join(dp, f)
        if rel.startswith('models/') and os.path.getsize(full) > 400_000:
            continue
        files.append('./' + rel)
files.sort()
urls = []
for f in files:
    if f.endswith('/index.html'):
        urls.append(f[:-10] or './')
    urls.append(f)
h = hashlib.sha256()
for f in files:
    with open(os.path.join(root, f[2:]), 'rb') as fh:
        h.update(fh.read())
sw_path = os.path.join(root, 'sw.js')
src = open(sw_path, encoding='utf-8').read()
src = re.sub(r'var VERSION = "[^"]*";', 'var VERSION = "%s";' % h.hexdigest()[:10], src)
src = re.sub(r'var SHELL = \[[\s\S]*?\];', 'var SHELL = ' + json.dumps(urls, indent=0) + ';', src)
open(sw_path, 'w', encoding='utf-8').write(src)
print('sw.js updated:', len(urls), 'entries, version', h.hexdigest()[:10])
