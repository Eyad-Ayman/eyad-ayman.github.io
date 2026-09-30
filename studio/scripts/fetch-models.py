#!/usr/bin/env python3
"""Download the on-device AI models into studio/models/ so the Studio can serve
them itself (optional — without this they download from Hugging Face on first use).

Files larger than 24 MB are split into <24 MB parts (GitHub's web uploader refuses
files over 25 MB) with a small JSON manifest the Studio reads:

    studio/models/migan_pipeline_v2.onnx.part1 … partN
    studio/models/migan_pipeline_v2.onnx.parts.json   {"parts": [...], "bytes": N, "sha256": "..."}

Usage:   python3 studio/scripts/fetch-models.py            (all models)
         python3 studio/scripts/fetch-models.py --split-only path/to/model.onnx
Standard library only.
"""
import hashlib, json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'models')
PART = 24 * 1000 * 1000  # < 24 MB

MODELS = [
    # MI-GAN pipeline v2 (MIT) — https://huggingface.co/andraniksargsyan/migan
    ('migan_pipeline_v2.onnx', [
        'https://huggingface.co/andraniksargsyan/migan/resolve/1538c135034b8cfe7a8472f34d09c8a5a45b17a7/migan_pipeline_v2.onnx',
        'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
    ]),
]


def download(urls, dest):
    last = None
    for url in urls:
        try:
            print('Downloading', url)
            req = urllib.request.Request(url, headers={'User-Agent': 'eyad-studio-fetch-models'})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest + '.tmp', 'wb') as f:
                total = int(r.headers.get('content-length') or 0)
                done = 0
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        sys.stdout.write('\r  %.1f / %.1f MB' % (done / 1e6, total / 1e6))
                        sys.stdout.flush()
            os.replace(dest + '.tmp', dest)
            print()
            return
        except Exception as e:  # try the next mirror
            last = e
            print('  failed:', e)
    raise SystemExit('Could not download %s: %s' % (os.path.basename(dest), last))


def split(path):
    """Write <file>.partN + <file>.parts.json next to `path` (always writes the manifest)."""
    name = os.path.basename(path)
    folder = os.path.dirname(path)
    data = open(path, 'rb').read()
    sha = hashlib.sha256(data).hexdigest()
    for f in os.listdir(folder):  # remove stale parts
        if f.startswith(name + '.part') and f[len(name) + 5:].isdigit():
            os.remove(os.path.join(folder, f))
    if len(data) <= PART:
        parts = [name]
    else:
        parts = []
        for i in range(0, len(data), PART):
            pn = '%s.part%d' % (name, i // PART + 1)
            with open(os.path.join(folder, pn), 'wb') as f:
                f.write(data[i:i + PART])
            parts.append(pn)
        os.remove(path)  # keep only the parts (the whole file is over the upload limit)
    with open(os.path.join(folder, name + '.parts.json'), 'w') as f:
        json.dump({'file': name, 'parts': parts, 'bytes': len(data), 'sha256': sha}, f, indent=1)
    print('%s: %d bytes -> %d part(s), sha256 %s' % (name, len(data), len(parts), sha[:12]))


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--split-only':
        split(os.path.abspath(sys.argv[2]))
        return
    os.makedirs(OUT, exist_ok=True)
    for name, urls in MODELS:
        dest = os.path.join(OUT, name)
        download(urls, dest)
        split(dest)
    print('Done. Commit studio/models/ (each file is under 25 MB).')


if __name__ == '__main__':
    main()
