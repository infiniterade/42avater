# 42gAvaterMaker: このフォルダーを http://localhost:8642/ で開くための小さなサーバー（このパソコンの中だけ）。
# MetaMask はファイルとして開いたページとはつながらないため、これを使います。止めるときはこの黒い画面を閉じます。
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$port = 8642
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
  $listener.Start()
} catch {
  # already running (an earlier window is still open): just open the page in the browser
  Write-Host ""
  Write-Host "  サーバーはもう動いています（前に開いた黒い画面が残っています）。そのままページを開きます。"
  Write-Host "  http://localhost:$port/avatars-placement.html"
  Write-Host ""
  Start-Process "http://localhost:$port/avatars-placement.html"
  exit 0
}
Write-Host ""
Write-Host "  42gAvaterMaker のページを開いています: http://localhost:$port/avatars-placement.html"
Write-Host "  メーカー:                               http://localhost:$port/42gAvaterMaker.html"
Write-Host "  終わったら、この画面を閉じてください。"
Write-Host ""
Start-Process "http://localhost:$port/avatars-placement.html"
$types = @{ '.html' = 'text/html; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.js' = 'text/javascript';
  '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png' }
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($path -eq '') { $path = 'avatars-placement.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($ctx.Request.HttpMethod -eq 'GET' -and $file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-store')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
