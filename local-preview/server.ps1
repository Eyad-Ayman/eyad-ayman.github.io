# Local preview server for eyad-ayman.github.io (portfolio + EYAD STUDIO).
# Browsers block module scripts, fetch() and fonts on file:// pages, so the
# gallery feeds and the Studio only work when served over http:// — exactly
# like GitHub Pages does. This tiny server needs nothing installed.
param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$Mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'
  '.webmanifest'='application/manifest+json'; '.xml'='application/xml'; '.txt'='text/plain; charset=utf-8'; '.md'='text/plain; charset=utf-8'
  '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.webp'='image/webp'; '.ico'='image/x-icon'; '.avif'='image/avif'
  '.woff2'='font/woff2'; '.woff'='font/woff'; '.ttf'='font/ttf'; '.otf'='font/otf'
  '.mp4'='video/mp4'; '.webm'='video/webm'; '.mov'='video/quicktime'; '.mp3'='audio/mpeg'; '.wav'='audio/wav'; '.m4a'='audio/mp4'
  '.wasm'='application/wasm'; '.pdf'='application/pdf'; '.zip'='application/zip'
}

$listener = $null
for ($i = 0; $i -lt 20; $i++) {
  try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()
    break
  } catch {
    $listener = $null
    $Port++
  }
}
if (-not $listener) { Write-Host 'Could not start a local server (all ports busy).'; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host "  Portfolio:   $url" -ForegroundColor Green
Write-Host "  EYAD STUDIO: ${url}studio/" -ForegroundColor Green
Write-Host ''
Write-Host '  Keep this window open while previewing. Press Ctrl+C to stop.'
Write-Host ''
try { Start-Process $url } catch { }

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    $path = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
    if (-not $path.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) { $res.StatusCode = 403; $res.Close(); continue }
    if (Test-Path -LiteralPath $path -PathType Container) {
      if (-not $req.Url.AbsolutePath.EndsWith('/')) {
        $res.StatusCode = 301
        $res.RedirectLocation = $req.Url.AbsolutePath + '/' + $req.Url.Query
        $res.Close(); continue
      }
      $path = Join-Path $path 'index.html'
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.OutputStream.Write($msg, 0, $msg.Length); $res.Close(); continue
    }
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    $type = $Mime[$ext]
    if (-not $type) { $type = 'application/octet-stream' }
    $res.ContentType = $type
    $res.AddHeader('Cache-Control', 'no-cache')
    $res.AddHeader('Accept-Ranges', 'bytes')
    $fs = [System.IO.File]::OpenRead($path)
    try {
      $len = $fs.Length
      $start = 0; $end = $len - 1
      $range = $req.Headers['Range']
      if ($range -and $range -match '^bytes=(\d*)-(\d*)$') {
        if ($Matches[1] -ne '') { $start = [int64]$Matches[1] }
        if ($Matches[2] -ne '') { $end = [int64]$Matches[2] }
        if ($Matches[1] -eq '' -and $Matches[2] -ne '') { $start = $len - [int64]$Matches[2]; $end = $len - 1 }
        if ($end -ge $len) { $end = $len - 1 }
        if ($start -gt $end -or $start -ge $len) {
          $res.StatusCode = 416; $res.AddHeader('Content-Range', "bytes */$len"); $res.Close(); continue
        }
        $res.StatusCode = 206
        $res.AddHeader('Content-Range', "bytes $start-$end/$len")
      }
      $count = $end - $start + 1
      $res.ContentLength64 = $count
      if ($req.HttpMethod -ne 'HEAD') {
        [void]$fs.Seek($start, 'Begin')
        $buf = New-Object byte[] 65536
        $left = $count
        while ($left -gt 0) {
          $n = $fs.Read($buf, 0, [int][Math]::Min($buf.Length, $left))
          if ($n -le 0) { break }
          $res.OutputStream.Write($buf, 0, $n)
          $left -= $n
        }
      }
    } finally { $fs.Close() }
  } catch {
    # client closed the connection (normal for video seeking)
  } finally {
    try { $res.Close() } catch { }
  }
}
