#Requires -Version 5.1
<##
LORE M0 transport for existing Windows PowerShell. The browser owns all CDAT
parsing/analysis. This script serves static files and a constrained Lenovo proxy.
It does not alter execution policy, certificate validation, firewall or URL ACLs.
##>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 8765,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$WebRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'web'))
$BaseUrl = "http://127.0.0.1:$Port"
$Authority = "127.0.0.1:$Port"
$MaxUpstreamBytes = 8MB
$MaxStaticBytes = 16MB
$Csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
$StaticTypes = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'; '.zip' = 'application/zip'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$HttpHandler = New-Object System.Net.Http.HttpClientHandler
$HttpHandler.AllowAutoRedirect = $false
# The default handler retains the system proxy and normal TLS certificate checks.
$Http = New-Object System.Net.Http.HttpClient($HttpHandler)
$Http.Timeout = [TimeSpan]::FromSeconds(20)

function Write-Response {
    param([IO.Stream]$Stream, [int]$Status, [string]$ContentType, [byte[]]$Body)
    $Reason = switch ($Status) {
        200 { 'OK' }; 400 { 'Bad Request' }; 403 { 'Forbidden' }
        404 { 'Not Found' }; 405 { 'Method Not Allowed' }; 413 { 'Content Too Large' }
        502 { 'Bad Gateway' }; 504 { 'Gateway Timeout' }; default { 'Error' }
    }
    $Head = "HTTP/1.1 $Status $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: no-referrer`r`nContent-Security-Policy: $Csp`r`nConnection: close`r`n`r`n"
    $Bytes = [Text.Encoding]::ASCII.GetBytes($Head)
    $Stream.Write($Bytes, 0, $Bytes.Length)
    $Stream.Write($Body, 0, $Body.Length)
    $Stream.Flush()
}

function Write-Json {
    param([IO.Stream]$Stream, [int]$Status, [object]$Value)
    $Bytes = $Utf8.GetBytes(($Value | ConvertTo-Json -Compress -Depth 5))
    Write-Response $Stream $Status 'application/json; charset=utf-8' $Bytes
}

function Throw-TransportError {
    param([string]$Message, [int]$Status = 502)
    $Exception = New-Object System.Exception($Message)
    $Exception.Data['Status'] = $Status
    throw $Exception
}

function Test-LenovoPath {
    param([string]$Path)
    return ($Path.Length -le 240 -and -not $Path.Contains('..') -and
        $Path -cmatch '\A(?:/catalog/[A-Za-z0-9]{4}_Win(?:10|11)\.xml|/pccbbs/mobiles/[A-Za-z0-9_.-]+\.(?:xml|txt|html))\z')
}

function Get-LenovoText {
    param([string]$Path)
    if (-not (Test-LenovoPath $Path)) {
        Throw-TransportError 'This Lenovo path is not allowed.' 400
    }
    $Url = "https://download.lenovo.com$Path"
    $Cancellation = New-Object System.Threading.CancellationTokenSource
    $Cancellation.CancelAfter(20000)
    $Request = New-Object System.Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, $Url)
    $Response = $null
    $InputStream = $null
    $BufferStream = New-Object IO.MemoryStream
    try {
        [void]$Request.Headers.TryAddWithoutValidation('User-Agent', 'LORE-M0/2.0 (local diagnostic metadata viewer)')
        [void]$Request.Headers.TryAddWithoutValidation('Accept', 'application/xml,text/plain,text/html;q=0.9,*/*;q=0.1')
        [void]$Request.Headers.TryAddWithoutValidation('Accept-Encoding', 'identity')
        $Response = $Http.SendAsync($Request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $Cancellation.Token).GetAwaiter().GetResult()
        $Code = [int]$Response.StatusCode
        if ($Code -ge 300 -and $Code -lt 400) {
            Throw-TransportError 'Lenovo returned a redirect; it was not followed.'
        }
        if ($Code -ne 200) { Throw-TransportError "Lenovo returned HTTP $Code. Please check the source and network." }
        foreach ($Encoding in $Response.Content.Headers.ContentEncoding) {
            if ($Encoding -ne 'identity') { Throw-TransportError 'Unsupported compression in the Lenovo response.' }
        }
        $Length = $Response.Content.Headers.ContentLength
        if ($null -ne $Length -and ($Length -lt 0 -or $Length -gt $MaxUpstreamBytes)) {
            Throw-TransportError 'The Lenovo response is too large.'
        }
        $InputStream = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $Buffer = New-Object byte[] 65536
        while ($true) {
            $Read = $InputStream.ReadAsync($Buffer, 0, [Math]::Min($Buffer.Length, $MaxUpstreamBytes + 1 - [int]$BufferStream.Length), $Cancellation.Token).GetAwaiter().GetResult()
            if ($Read -eq 0) { break }
            if ($BufferStream.Length + $Read -gt $MaxUpstreamBytes) { Throw-TransportError 'The Lenovo response is too large.' }
            $BufferStream.Write($Buffer, 0, $Read)
        }
        if ($null -ne $Length -and $BufferStream.Length -ne $Length) {
            Throw-TransportError 'The Lenovo response was incomplete.'
        }
        $Decoder = $Utf8
        if ($null -ne $Response.Content.Headers.ContentType -and $Response.Content.Headers.ContentType.CharSet) {
            try { $Decoder = [Text.Encoding]::GetEncoding($Response.Content.Headers.ContentType.CharSet.Trim('"')) } catch { $Decoder = $Utf8 }
        }
        return @{
            url = $Url
            retrievedAt = [DateTime]::UtcNow.ToString('o')
            text = $Decoder.GetString($BufferStream.ToArray()).TrimStart([char]0xFEFF)
        }
    } catch {
        if ($_.Exception.Data.Contains('Status')) { throw }
        if ($Cancellation.IsCancellationRequested) { Throw-TransportError 'The Lenovo request timed out.' 504 }
        Throw-TransportError 'Lenovo is unreachable. Check the connection, proxy and certificates.'
    } finally {
        if ($null -ne $InputStream) { $InputStream.Dispose() }
        if ($null -ne $Response) { $Response.Dispose() }
        $Request.Dispose()
        $Cancellation.Dispose()
        $BufferStream.Dispose()
    }
}

function Read-Request {
    param([IO.Stream]$Stream)
    $Memory = New-Object IO.MemoryStream
    $Timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        # One request per connection, capped headers, no HTTP body or pipelining.
        $Buffer = New-Object byte[] 1024
        while ($Memory.Length -le 16384 -and $Timer.ElapsedMilliseconds -lt 5000) {
            $Read = $Stream.Read($Buffer, 0, $Buffer.Length)
            if ($Read -eq 0) { Throw-TransportError 'Incomplete HTTP request.' 400 }
            $Memory.Write($Buffer, 0, $Read)
            if ($Memory.Length -gt 16384) { break }
            $Text = [Text.Encoding]::ASCII.GetString($Memory.ToArray())
            $End = $Text.IndexOf("`r`n`r`n", [StringComparison]::Ordinal)
            if ($End -ge 0) {
                $Lines = $Text.Substring(0, $End).Split(@("`r`n"), [StringSplitOptions]::None)
                if ($Lines[0] -cnotmatch '\A([A-Z]+) (/[^ ]*) HTTP/1\.[01]\z') {
                    Throw-TransportError 'Invalid HTTP request.' 400
                }
                $Method = $Matches[1]
                $Target = $Matches[2]
                if ($Target.Length -gt 1024 -or $Target.StartsWith('//')) { Throw-TransportError 'Invalid request path.' 400 }
                $Headers = @{}
                for ($Index = 1; $Index -lt $Lines.Length; $Index++) {
                    if ($Lines[$Index] -notmatch '\A([A-Za-z0-9-]+):[ \t]*(.*)\z') { Throw-TransportError 'Invalid HTTP header.' 400 }
                    $Name = $Matches[1].ToLowerInvariant()
                    if ($Headers.ContainsKey($Name)) { Throw-TransportError 'Duplicate HTTP headers are not accepted.' 400 }
                    $Headers[$Name] = $Matches[2].Trim()
                }
                if ($Headers.ContainsKey('transfer-encoding') -or ($Headers.ContainsKey('content-length') -and $Headers['content-length'] -ne '0')) {
                    Throw-TransportError 'Requests with a body are not accepted.' 400
                }
                return @{ Method = $Method; Target = $Target; Headers = $Headers }
            }
        }
        Throw-TransportError 'HTTP headers too large or request timed out.' 400
    } finally { $Memory.Dispose(); $Timer.Stop() }
}

function Handle-Request {
    param([IO.Stream]$Stream, [hashtable]$Request)
    $Headers = $Request.Headers
    if (-not $Headers.ContainsKey('host') -or $Headers['host'] -cne $Authority -or
        ($Headers.ContainsKey('origin') -and $Headers['origin'] -cne $BaseUrl) -or
        ($Headers.ContainsKey('sec-fetch-site') -and $Headers['sec-fetch-site'] -in @('cross-site', 'same-site'))) {
        Throw-TransportError 'Only requests from the local LORE interface are allowed.' 403
    }
    if ($Request.Method -cne 'GET') { Throw-TransportError 'This method is not supported.' 405 }
    $Target = $Request.Target
    if ($Target.Contains('#')) { Throw-TransportError 'Fragments are not allowed.' 400 }
    $Parts = $Target.Split([char[]]'?', 2)
    $Route = $Parts[0]
    $Query = if ($Parts.Length -gt 1) { $Parts[1] } else { '' }
    if ($Route.StartsWith('/api/', [StringComparison]::Ordinal)) {
        if (-not $Headers.ContainsKey('x-lore-request') -or $Headers['x-lore-request'] -cne '1') {
            Throw-TransportError 'The request must come from the LORE interface.' 403
        }
        if ($Route -ceq '/api/health' -and -not $Query) {
            Write-Json $Stream 200 @{ version = '2.0.0-m0'; platform = 'powershell'; localOnly = $true }
            return
        }
        if ($Route -cne '/api/lenovo') { Throw-TransportError 'Unknown API address.' 404 }
        if ($Query -cnotmatch '\Apath=([^&]+)\z') { Throw-TransportError 'Exactly one Lenovo path is required.' 400 }
        $Path = [Uri]::UnescapeDataString($Matches[1].Replace('+', ' '))
        Write-Json $Stream 200 (Get-LenovoText $Path)
        return
    }
    if ($Query) { Throw-TransportError 'Query parameters are not allowed here.' 400 }
    $Decoded = [Uri]::UnescapeDataString($Route)
    if ($Decoded.Contains('\') -or $Decoded.Contains([char]0) -or $Decoded.Contains(':')) { Throw-TransportError 'Invalid file path.' 400 }
    foreach ($Part in $Decoded.Split('/')) {
        if ($Part.StartsWith('.')) { Throw-TransportError 'Invalid file path.' 400 }
    }
    $Relative = if ($Decoded -ceq '/') { 'index.html' } else { $Decoded.TrimStart('/') }
    $File = [IO.Path]::GetFullPath((Join-Path $WebRoot $Relative))
    if (-not $File.StartsWith($WebRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-TransportError 'File not found.' 404
    }
    # Reject reparse points anywhere below web/, including junctions and symlinks.
    $Current = $WebRoot
    foreach ($Part in $Relative.Split('/')) {
        $Current = Join-Path $Current $Part
        if (-not (Test-Path -LiteralPath $Current)) { Throw-TransportError 'File not found.' 404 }
        $Item = Get-Item -LiteralPath $Current -Force
        if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Throw-TransportError 'File not found.' 404 }
    }
    $Extension = [IO.Path]::GetExtension($File).ToLowerInvariant()
    if (-not [IO.File]::Exists($File) -or -not $StaticTypes.ContainsKey($Extension)) { Throw-TransportError 'File not found.' 404 }
    if ((Get-Item -LiteralPath $File).Length -gt $MaxStaticBytes) { Throw-TransportError 'The static file is too large.' 413 }
    Write-Response $Stream 200 $StaticTypes[$Extension] ([IO.File]::ReadAllBytes($File))
}

$Listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
try {
    $Listener.Start()
    Write-Host "LORE M0: $BaseUrl/"
    Write-Host 'Stop: Ctrl+C. CDAT files stay in the browser.'
    if (-not $NoBrowser) { Start-Process "$BaseUrl/" }
    while ($true) {
        $Accept = $Listener.BeginAcceptTcpClient($null, $null)
        while (-not $Accept.AsyncWaitHandle.WaitOne(200)) { }
        $Client = $Listener.EndAcceptTcpClient($Accept)
        $Accept.AsyncWaitHandle.Close()
        $Client.ReceiveTimeout = 5000
        $Client.SendTimeout = 20000
        $Stream = $Client.GetStream()
        try {
            Handle-Request $Stream (Read-Request $Stream)
        } catch {
            $Status = 502
            $Message = 'The local request could not be processed.'
            if ($_.Exception.Data.Contains('Status')) {
                $Status = [int]$_.Exception.Data['Status']
                $Message = $_.Exception.Message
            }
            try { Write-Json $Stream $Status @{ error = $Message } } catch { }
        } finally {
            $Stream.Dispose()
            $Client.Close()
        }
    }
} finally {
    $Listener.Stop()
    $Http.Dispose()
    $HttpHandler.Dispose()
}
