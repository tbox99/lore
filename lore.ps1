#!/usr/bin/env pwsh
#Requires -Version 5.1
<#
.SYNOPSIS
    LORE - Lenovo Online Research & Equipment (PowerShell Edition)
.DESCRIPTION
    Starts a local HTTP server and opens an interactive HTML interface that
    replicates the LORE Tauri desktop app. Supports serial/MTM lookup,
    product browsing with model selection dropdown, driver listing, and
    warranty checks.
.EXAMPLE
    .\lore.ps1
    .\lore.ps1 PF4SQLH9
#>

param(
    [Parameter(Mandatory = $false, Position = 0)]
    [string]$Serial = '',

    [Parameter(Mandatory = $false)]
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
$script:BaseApiUrl = 'https://pcsupport.lenovo.com/us/en/api/v4'
$script:UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
$script:CacheDir = Join-Path $env:TEMP 'lore'
$script:TTLProduct = 3600
$script:TTLDrivers = 21600
$script:TTLWarranty = 86400
$script:TTLSession = 1800
$script:SessionCookie = $null
$script:SessionCookieAt = $null
$script:Listener = $null

# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------
function Ensure-CacheDir {
    if (-not (Test-Path $script:CacheDir)) { New-Item -ItemType Directory -Path $script:CacheDir -Force | Out-Null }
}

function Get-SafeCachePath {
    param([string]$Key)
    Ensure-CacheDir
    $safe = $Key -replace '[^a-zA-Z0-9_-]', '_'
    return (Join-Path $script:CacheDir ($safe + '.json'))
}

function Get-Cached {
    param([string]$Key, [int]$TtlSeconds)
    $path = Get-SafeCachePath -Key $Key
    if (-not (Test-Path $path)) { return $null }
    $age = ([DateTime]::UtcNow - (Get-Item $path).LastWriteTimeUtc).TotalSeconds
    if ($age -gt $TtlSeconds) {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        return $null
    }
    try { return Get-Content $path -Raw | ConvertFrom-Json } catch { return $null }
}

function Set-Cached {
    param([string]$Key, $Data)
    $path = Get-SafeCachePath -Key $Key
    $Data | ConvertTo-Json -Depth 50 | Set-Content $path -Encoding UTF8
}

# ---------------------------------------------------------------------------
# Property helpers
# ---------------------------------------------------------------------------
function Get-Prop {
    param($Object, [string[]]$Names, $Default = '')
    if ($null -eq $Object) { return $Default }
    foreach ($name in $Names) {
        if ($Object.PSObject.Properties[$name]) {
            $value = $Object.PSObject.Properties[$name].Value
            if ($null -ne $value -and "$value" -ne '') { return $value }
        }
    }
    return $Default
}

function Convert-ToArray {
    param($Value)
    if ($null -eq $Value) { return @() }
    if ($Value -is [System.Array]) { return @($Value) }
    return @($Value)
}

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
function Invoke-LenovoGet {
    param([string]$Url)
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $headers = @{
        'User-Agent' = $script:UserAgent
        'Accept' = 'application/json, text/plain, */*'
        'Accept-Language' = 'en-US,en;q=0.9'
        'Referer' = 'https://pcsupport.lenovo.com/us/en/warranty-lookup'
    }
    $response = Invoke-WebRequest -Uri $Url -Headers $headers -UseBasicParsing -TimeoutSec 30
    return ($response.Content | ConvertFrom-Json)
}

function Get-SessionCookie {
    if ($script:SessionCookie -and $script:SessionCookieAt) {
        $age = ([DateTime]::UtcNow - $script:SessionCookieAt).TotalSeconds
        if ($age -lt $script:TTLSession) { return $script:SessionCookie }
    }
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $response = Invoke-WebRequest -Uri 'https://pcsupport.lenovo.com/us/en/warranty-lookup' -Headers @{ 'User-Agent' = $script:UserAgent } -UseBasicParsing -TimeoutSec 30
    foreach ($cookie in (Convert-ToArray $response.Headers['Set-Cookie'])) {
        if ($cookie -match 'Lenovo_SessionID=([^;]+)') {
            $script:SessionCookie = $Matches[1]
            $script:SessionCookieAt = [DateTime]::UtcNow
            return $script:SessionCookie
        }
    }
    return $null
}

function Invoke-WarrantyPost {
    param([string]$Body)
    $sessionId = Get-SessionCookie
    if (-not $sessionId) { return $null }
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $headers = @{
        'User-Agent' = $script:UserAgent
        'Accept' = 'application/json, text/plain, */*'
        'Accept-Language' = 'en-US,en;q=0.9'
        'Content-Type' = 'application/json'
        'Origin' = 'https://pcsupport.lenovo.com'
        'Referer' = 'https://pcsupport.lenovo.com/us/en/warranty-lookup'
        'Cookie' = "Lenovo_SessionID=$sessionId"
    }
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        $response = Invoke-WebRequest -Uri ($script:BaseApiUrl + '/upsell/redport/getIbaseInfo') -Method Post -Body $Body -Headers $headers -UseBasicParsing -TimeoutSec 30
        $result = $response.Content | ConvertFrom-Json
        if ((Get-Prop $result @('code') '') -eq 100) {
            $script:SessionCookie = $null
            $script:SessionCookieAt = $null
            $sessionId = Get-SessionCookie
            if (-not $sessionId) { return $null }
            $headers['Cookie'] = "Lenovo_SessionID=$sessionId"
        } else {
            return (Get-Prop $result @('data') $result)
        }
    }
    return $null
}

# ---------------------------------------------------------------------------
# API calls
# ---------------------------------------------------------------------------
function Find-Product {
    param([string]$Identifier)
    $cached = Get-Cached -Key ('product:' + $Identifier) -TtlSeconds $script:TTLProduct
    if ($cached) { return (Convert-ToArray $cached) }
    $url = $script:BaseApiUrl + '/mse/getproducts?productId=' + [Uri]::EscapeDataString($Identifier)
    $items = Convert-ToArray (Invoke-LenovoGet -Url $url)
    Set-Cached -Key ('product:' + $Identifier) -Data $items
    return $items
}

function Get-Drivers {
    param([string]$ProductPath)
    $cached = Get-Cached -Key ('drivers:' + $ProductPath) -TtlSeconds $script:TTLDrivers
    if ($cached) { return $cached }
    $url = $script:BaseApiUrl + '/downloads/drivers?productId=' + [Uri]::EscapeDataString($ProductPath)
    $result = Invoke-LenovoGet -Url $url
    Set-Cached -Key ('drivers:' + $ProductPath) -Data $result
    return $result
}

function Get-Warranty {
    param([string]$SerialNumber, [string]$MachineType)
    $cacheKey = 'warranty:' + $SerialNumber + ':' + $MachineType + ':us:en'
    $cached = Get-Cached -Key $cacheKey -TtlSeconds $script:TTLWarranty
    if ($cached) { return $cached }
    $body = @{ serialNumber = $SerialNumber; machineType = $MachineType; country = 'us'; language = 'en' } | ConvertTo-Json -Compress
    $result = Invoke-WarrantyPost -Body $body
    if ($null -ne $result) { Set-Cached -Key $cacheKey -Data $result }
    return $result
}

function Find-BrowseProducts {
    param([string]$Query)
    $cached = Get-Cached -Key ('browse:' + $Query) -TtlSeconds $script:TTLProduct
    if ($cached) { return (Convert-ToArray $cached) }
    $url = $script:BaseApiUrl + '/mse/getproducts?productId=' + [Uri]::EscapeDataString($Query)
    $items = Convert-ToArray (Invoke-LenovoGet -Url $url)
    Set-Cached -Key ('browse:' + $Query) -Data $items
    return $items
}

function Get-Readme {
    param([string]$Url)
    $cacheKey = 'readme:' + $Url
    $cached = Get-Cached -Key $cacheKey -TtlSeconds $script:TTLDrivers
    if ($cached) { return $cached }
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        $response = Invoke-WebRequest -Uri $Url -Headers @{ 'User-Agent' = $script:UserAgent } -UseBasicParsing -TimeoutSec 15
        $content = $response.Content
        $result = @{ content = $content }
        Set-Cached -Key $cacheKey -Data $result
        return $result
    } catch {
        return @{ content = $null }
    }
}

# ---------------------------------------------------------------------------
# Data extraction helpers
# ---------------------------------------------------------------------------
function Get-MachineType {
    param($Product)
    $mtm = Get-Prop $Product @('Mtm', 'MTM', 'mtm') ''
    if ($mtm) { return "$mtm" }
    $name = Get-Prop $Product @('Name', 'name') ''
    $regexMatches = [regex]::Matches($name, 'Type\s+([A-Za-z0-9]{4})')
    if ($regexMatches.Count -gt 0) { return $regexMatches[$regexMatches.Count - 1].Groups[1].Value }
    $id = Get-Prop $Product @('Id', 'id') ''
    $parts = "$id".TrimEnd('/').Split('/')
    for ($i = $parts.Length - 1; $i -ge 0; $i--) {
        if ($parts[$i] -match '^[A-Za-z0-9]{4}$') { return $parts[$i] }
    }
    return ''
}

function Get-ProductImage {
    param($Product)
    $image = Get-Prop $Product @('Image', 'image', 'ImageUrl', 'imageUrl', 'ProductImage', 'productImage') ''
    if (-not $image) { return '' }
    if ($image -match '^//') { return 'https:' + $image }
    if ($image -match '^https?://') { return "$image" }
    if ($image -match '^/') { return 'https://pcsupport.lenovo.com' + $image }
    return "$image"
}

function Get-ShortTitle {
    param([string]$Title)
    if (-not $Title) { return 'N/A' }
    $m = [regex]::Match($Title, '(?i)\s+for\s+Windows')
    if ($m.Success) { return $Title.Substring(0, $m.Index).TrimEnd(' ', '-') }
    $m = [regex]::Match($Title, '\s+-\s+')
    if ($m.Success) { return $Title.Substring(0, $m.Index).TrimEnd(' ', '-') }
    return $Title.TrimEnd(' ', '-')
}

function Get-NormalizedPriority {
    param([string]$Priority, [int64]$PriorityWeight)
    if ($Priority) {
        $p = $Priority.Trim().ToLower()
        if ($p -match 'critical') { return 'Critical' }
        if ($p -match 'recommend') { return 'Recommended' }
        if ($p -match 'optional') { return 'Optional' }
    }
    if ($PriorityWeight -ge 3) { return 'Critical' }
    if ($PriorityWeight -ge 2) { return 'Recommended' }
    return 'Optional'
}

function ConvertFrom-EpochMs {
    param($Value)
    if ($null -eq $Value -or "$Value" -eq '' -or "$Value" -eq '0') { return 'N/A' }
    try { return [DateTimeOffset]::FromUnixTimeMilliseconds([Int64]$Value).LocalDateTime.ToString('yyyy-MM-dd') } catch { return 'N/A' }
}

function Get-DateField {
    param($Object, [string[]]$Names)
    foreach ($name in $Names) {
        $value = Get-Prop $Object @($name) $null
        if ($null -eq $value) { continue }
        if ($value.PSObject.Properties['Unix']) { return (ConvertFrom-EpochMs $value.Unix) }
        if ("$value" -match '^\d{12,}$') { return (ConvertFrom-EpochMs $value) }
        if ("$value" -ne '') { return "$value" }
    }
    return 'N/A'
}

function Get-DriverItems {
    param($DriversData)
    if ($null -eq $DriversData) { return @() }
    if ($DriversData.PSObject.Properties['body']) {
        if ($DriversData.body.PSObject.Properties['DownloadItems']) { return (Convert-ToArray $DriversData.body.DownloadItems) }
        if ($DriversData.body.PSObject.Properties['downloadItems']) { return (Convert-ToArray $DriversData.body.downloadItems) }
    }
    if ($DriversData.PSObject.Properties['DownloadItems']) { return (Convert-ToArray $DriversData.DownloadItems) }
    if ($DriversData.PSObject.Properties['downloadItems']) { return (Convert-ToArray $DriversData.downloadItems) }
    return @()
}

# ---------------------------------------------------------------------------
# JSON response helpers
# ---------------------------------------------------------------------------
function Send-JsonResponse {
    param($Context, $Data, [int]$StatusCode = 200)
    # PS 5.1: ensure single-element arrays stay arrays in JSON output
    if ($Data -is [System.Collections.Hashtable] -or $Data -is [System.Collections.Specialized.OrderedDictionary]) {
        if ($Data.ContainsKey('drivers') -and $Data['drivers'] -is [System.Collections.Hashtable]) {
            if ($Data['drivers'].ContainsKey('drivers')) {
                $Data['drivers']['drivers'] = @($Data['drivers']['drivers'])
            }
        }
        if ($Data.ContainsKey('product') -and $Data['product'] -is [System.Collections.Hashtable]) {
            if ($Data['product'].ContainsKey('image') -and [string]::IsNullOrEmpty($Data['product']['image'])) {
                $Data['product']['image'] = $null
            }
        }
    }
    # Ensure the top-level data is properly wrapped for JSON serialization
    # PS 5.1 ConvertTo-Json unrolls single-element arrays
    $json = $Data | ConvertTo-Json -Depth 50 -Compress
    $json = $json -replace '"True"', 'true' -replace '"False"', 'false'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.AddHeader('Access-Control-Allow-Origin', '*')
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Send-ErrorResponse {
    param($Context, [string]$Message, [int]$StatusCode = 500)
    Send-JsonResponse -Context $Context -Data @{ success = $false; error = $Message } -StatusCode $StatusCode
}

function Send-HtmlResponse {
    param($Context, [string]$Html)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Html)
    $Context.Response.StatusCode = 200
    $Context.Response.ContentType = 'text/html; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

# ---------------------------------------------------------------------------
# API handlers
# ---------------------------------------------------------------------------
function Handle-Search {
    param($Context, [string]$QueryString)
    # Parse query params
    $params = @{}
    foreach ($pair in $QueryString.Split('&')) {
        $idx = $pair.IndexOf('=')
        if ($idx -ge 0) {
            $key = [Uri]::UnescapeDataString($pair.Substring(0, $idx))
            $val = [Uri]::UnescapeDataString($pair.Substring($idx + 1))
            $params[$key] = $val
        }
    }

    $serial = ''
    if ($params.ContainsKey('serial')) { $serial = $params['serial'] }
    if ($params.ContainsKey('query')) { $serial = $params['query'] }

    if (-not $serial) {
        Send-ErrorResponse -Context $Context -Message 'Missing serial or query parameter' -StatusCode 400
        return
    }

    # Normalize search term
    $serial = $serial.Trim().ToUpper()
    $serial = $serial -replace '[^A-Z0-9]', ''

    try {
        # Find product
        $products = Find-Product -Identifier $serial
        if (-not $products -or $products.Count -eq 0) {
            Send-JsonResponse -Context $Context -Data @{ success = $false; error = "No product found for '$serial'" }
            return
        }

        # Pick best product match
        $product = $products[0]
        foreach ($p in $products) {
            $mtm = Get-Prop $p @('Mtm', 'MTM', 'mtm') ''
            if ($mtm -and ($serial.StartsWith($mtm) -or $mtm.StartsWith($serial))) {
                $product = $p
                break
            }
        }

        # Extract product path for drivers
        $productId = Get-Prop $product @('Id', 'id', 'ProductPath', 'path') ''
        $mtm = Get-Prop $product @('Mtm', 'MTM', 'mtm') ''
        $machineType = Get-MachineType -Product $product
        $name = Get-Prop $product @('Name', 'name') 'Unknown Device'

        # Build driver path
        $driverPath = ''
        if ($productId) {
            $driverPath = "$productId".Trim('/')
        }
        if (-not $driverPath -and $mtm) {
            $driverPath = "products/$mtm"
        }

        # Fetch drivers
        $driversData = $null
        $driverItems = @()
        if ($driverPath) {
            try {
                $driversData = Get-Drivers -ProductPath $driverPath
                $driverItems = Get-DriverItems -DriversData $driversData
            } catch {
                # Drivers might fail, continue without them
            }
        }

        # Fetch warranty
        $warrantyData = $null
        if ($serial -and $machineType) {
            try {
                $warrantyData = Get-Warranty -SerialNumber $serial -MachineType $machineType
            } catch {
                # Warranty might fail, continue without it
            }
        }

        # Build driver list
        $driversList = @()
        foreach ($item in $driverItems) {
            $title = Get-Prop $item @('Title', 'title') ''
            $shortTitle = Get-Prop $item @('ShortTitle', 'shortTitle') ''
            if (-not $shortTitle) { $shortTitle = (Get-ShortTitle $title) }

            $files = Convert-ToArray (Get-Prop $item @('Files', 'files') $null)
            $osKeys = @()
            foreach ($file in $files) {
                foreach ($field in @('OperatingSystemKeys', 'OperatingSystems', 'OS', 'Os')) {
                    $fileOsList = Convert-ToArray (Get-Prop $file @($field) $null)
                    foreach ($osItem in $fileOsList) {
                        if ($osItem) { $osKeys = @($osKeys) + @("$osItem") }
                    }
                }
            }
            $osKeys = @($osKeys | Sort-Object -Unique)

            $rawCategory = Get-Prop $item @('Category', 'category') 'Uncategorized'
            # Category might be an object with a Name sub-field (Lenovo API)
            $categoryName = 'Uncategorized'
            if ($rawCategory -and $rawCategory.PSObject.Properties['Name']) {
                $categoryName = $rawCategory.Name
            } elseif ($rawCategory -is [string]) {
                $categoryName = $rawCategory
            } elseif ($rawCategory -and "$rawCategory" -ne 'Uncategorized') {
                $categoryName = "$rawCategory"
            }

            # Extract priority from SummaryInfo if not on top level
            $rawPriority = Get-Prop $item @('Priority', 'priority') ''
            $rawPriorityWeight = Get-Prop $item @('PriorityWeight', 'priorityWeight') '0'
            # Check Files for priority/weight
            if (-not $rawPriority -and $files.Count -gt 0) {
                $filePriority = Get-Prop $files[0] @('Priority', 'priority') ''
                $filePriorityWeight = Get-Prop $files[0] @('PriorityWeight', 'priorityWeight') '0'
                if ($filePriority) { $rawPriority = $filePriority }
                if ($filePriorityWeight -and [int64]$filePriorityWeight -gt [int64]$rawPriorityWeight) { $rawPriorityWeight = $filePriorityWeight }
            }
            # Check SummaryInfo for priority
            $summaryInfo = Get-Prop $item @('SummaryInfo', 'summaryInfo') $null
            if ($summaryInfo -and $summaryInfo.PSObject.Properties['Priority'] -and -not $rawPriority) {
                $rawPriority = $summaryInfo.Priority
            }
            $priorityWeight = [int64]$rawPriorityWeight
            $normalizedPriority = Get-NormalizedPriority -Priority $rawPriority -PriorityWeight $priorityWeight

            # Extract version from Files if not on top level
            $rawVersion = Get-Prop $item @('Version', 'version') ''
            if (-not $rawVersion -and $files.Count -gt 0) {
                $rawVersion = Get-Prop $files[0] @('Version', 'version') ''
            }
            if (-not $rawVersion) { $rawVersion = 'N/A' }

            # Extract size from Files
            $rawSize = Get-Prop $item @('Size', 'size') ''
            if (-not $rawSize -and $files.Count -gt 0) {
                $rawSize = Get-Prop $files[0] @('Size', 'size') ''
            }
            if (-not $rawSize) { $rawSize = 'N/A' }

            # Download URL from Files
            $downloadUrl = ''
            if ($files.Count -gt 0) {
                $downloadUrl = Get-Prop $files[0] @('URL', 'Url', 'url', 'DownloadUrl', 'downloadUrl') ''
            }
            if (-not $downloadUrl) {
                $downloadUrl = Get-Prop $item @('Url', 'url', 'DownloadUrl', 'downloadUrl') ''
            }

            # Readme URL from Files
            $readmeUrl = ''
            if ($files.Count -gt 0) {
                $readmeUrl = Get-Prop $files[0] @('ReadmeUrl', 'readmeUrl') ''
            }
            if (-not $readmeUrl) {
                $readmeUrl = Get-Prop $item @('ReadmeUrl', 'readmeUrl') ''
            }

            # SHA256 from Files
            $rawSha256 = Get-Prop $item @('SHA256', 'sha256') ''
            if (-not $rawSha256 -and $files.Count -gt 0) {
                $rawSha256 = Get-Prop $files[0] @('SHA256', 'sha256') ''
            }

            # RequireLogin
            $rawRequireLogin = Get-Prop $item @('RequireLogin', 'requireLogin') ''
            $requireLogin = $false
            if ($rawRequireLogin -and "$rawRequireLogin" -match 'true|1') { $requireLogin = $true }

            # ReleaseNotes
            $releaseNotes = Get-Prop $item @('ReleaseNotes', 'releaseNotes') ''

            $driverEntry = @{
                title = $title
                shortTitle = $shortTitle
                category = $categoryName
                priority = $normalizedPriority
                version = $rawVersion
                released = (Get-DateField $item @('Date', 'ReleaseDate', 'released'))
                updated = (Get-DateField $item @('Updated', 'UpdateDate', 'updated'))
                size = $rawSize
                url = $downloadUrl
                readmeUrl = $readmeUrl
                docId = Get-Prop $item @('DocId', 'docId') ''
                sha256 = $rawSha256
                osKeys = $osKeys
                summary = Get-Prop $item @('Summary', 'summary') ''
                releaseNotes = $releaseNotes
                requireLogin = $requireLogin
            }
            $driversList = @($driversList) + @($driverEntry)
        }

        # Build warranty result
        $warrantyResult = $null
        if ($warrantyData) {
            $machineInfo = Get-Prop $warrantyData @('MachineInfo', 'machineInfo') $null
            $warrantyStatus = Get-Prop $warrantyData @('WarrantyStatus', 'warrantyStatus') ''
            $baseWarranties = Convert-ToArray (Get-Prop $warrantyData @('BaseWarranties', 'baseWarranties') @())
            $upgradeWarranties = Convert-ToArray (Get-Prop $warrantyData @('UpgradeWarranties', 'upgradeWarranties') @())
            $currentWarrantyObj = Get-Prop $warrantyData @('CurrentWarranty', 'currentWarranty') $null

            # Build machineInfo separately (PS 5.1 can't handle if-expressions inside hashtables)
            $machineInfoResult = $null
            if ($machineInfo) {
                $machineInfoResult = @{
                    product = Get-Prop $machineInfo @('Product', 'product', 'ProductName', 'productName') ''
                    type = Get-Prop $machineInfo @('Type', 'type') ''
                    serial = Get-Prop $machineInfo @('Serial', 'serial') ''
                    buildDate = Get-Prop $machineInfo @('BuildDate', 'buildDate') ''
                    shipDate = Get-Prop $machineInfo @('ShipDate', 'shipDate') ''
                    popDate = Get-Prop $machineInfo @('POPDate', 'popDate') ''
                    shipToCountry = Get-Prop $machineInfo @('ShipToCountry', 'shipToCountry') ''
                    eosDate = Get-Prop $machineInfo @('EOSDate', 'eosDate') ''
                }
            }

            # Build warranty arrays separately
            $baseWarrantiesResult = @()
            foreach ($w in $baseWarranties) {
                $baseWarrantiesResult = @($baseWarrantiesResult) + @{
                    type = Get-Prop $w @('Type', 'type') ''
                    name = Get-Prop $w @('Name', 'name') ''
                    startDate = Get-Prop $w @('StartDate', 'startDate') ''
                    endDate = Get-Prop $w @('EndDate', 'endDate') ''
                    status = Get-Prop $w @('Status', 'status') ''
                }
            }

            $upgradeWarrantiesResult = @()
            foreach ($w in $upgradeWarranties) {
                $upgradeWarrantiesResult = @($upgradeWarrantiesResult) + @{
                    type = Get-Prop $w @('Type', 'type') ''
                    name = Get-Prop $w @('Name', 'name') ''
                    startDate = Get-Prop $w @('StartDate', 'startDate') ''
                    endDate = Get-Prop $w @('EndDate', 'endDate') ''
                    status = Get-Prop $w @('Status', 'status') ''
                }
            }

            $currentWarrantyResult = $null
            if ($currentWarrantyObj) {
                $currentWarrantyResult = @{
                    startDate = Get-Prop $currentWarrantyObj @('StartDate', 'startDate') ''
                    endDate = Get-Prop $currentWarrantyObj @('EndDate', 'endDate') ''
                }
            }

            $warrantyResult = @{
                warrantyStatus = $warrantyStatus
                machineInfo = $machineInfoResult
                baseWarranties = $baseWarrantiesResult
                upgradeWarranties = $upgradeWarrantiesResult
                currentWarranty = $currentWarrantyResult
            }
        }

        # Build product info
        $productInfo = @{
            name = $name
            mtm = $mtm
            machineType = $machineType
            id = $productId
            image = Get-ProductImage -Product $product
        }

        Send-JsonResponse -Context $Context -Data @{
            success = $true
            serial = $serial
            product = $productInfo
            drivers = @{
                product = $productInfo
                productName = $name
                drivers = $driversList
                generatedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
            }
            warranty = $warrantyResult
        }
    } catch {
        Send-ErrorResponse -Context $Context -Message $_.Exception.Message
    }
}

function Handle-SearchDropdown {
    param($Context, [string]$QueryString)
    $params = @{}
    foreach ($pair in $QueryString.Split('&')) {
        $idx = $pair.IndexOf('=')
        if ($idx -ge 0) {
            $key = [Uri]::UnescapeDataString($pair.Substring(0, $idx))
            $val = [Uri]::UnescapeDataString($pair.Substring($idx + 1))
            $params[$key] = $val
        }
    }

    $query = ''
    if ($params.ContainsKey('query')) { $query = $params['query'] }
    if (-not $query) {
        Send-JsonResponse -Context $Context -Data @()
        return
    }

    try {
        $products = Find-Product -Identifier $query
        $results = @($products | ForEach-Object {
            @{
                name = Get-Prop $_ @('Name', 'name') ''
                mtm = Get-Prop $_ @('Mtm', 'MTM', 'mtm') ''
                id = Get-Prop $_ @('Id', 'id') ''
            }
        } | Select-Object -First 15)
        Send-JsonResponse -Context $Context -Data $results
    } catch {
        Send-JsonResponse -Context $Context -Data @()
    }
}

function Handle-Browse {
    param($Context, [string]$QueryString)
    $params = @{}
    foreach ($pair in $QueryString.Split('&')) {
        $idx = $pair.IndexOf('=')
        if ($idx -ge 0) {
            $key = [Uri]::UnescapeDataString($pair.Substring(0, $idx))
            $val = [Uri]::UnescapeDataString($pair.Substring($idx + 1))
            $params[$key] = $val
        }
    }

    $productId = ''
    if ($params.ContainsKey('productId')) { $productId = $params['productId'] }
    if (-not $productId) {
        Send-JsonResponse -Context $Context -Data @()
        return
    }

    try {
        $products = Find-BrowseProducts -Query $productId
        $results = @($products | ForEach-Object {
            @{
                name = Get-Prop $_ @('Name', 'name') ''
                mtm = Get-Prop $_ @('Mtm', 'MTM', 'mtm') ''
                id = Get-Prop $_ @('Id', 'id') ''
                image = Get-ProductImage -Product $_
            }
        })
        Send-JsonResponse -Context $Context -Data $results
    } catch {
        Send-JsonResponse -Context $Context -Data @()
    }
}

function Handle-Readme {
    param($Context, [string]$QueryString)
    $params = @{}
    foreach ($pair in $QueryString.Split('&')) {
        $idx = $pair.IndexOf('=')
        if ($idx -ge 0) {
            $key = [Uri]::UnescapeDataString($pair.Substring(0, $idx))
            $val = [Uri]::UnescapeDataString($pair.Substring($idx + 1))
            $params[$key] = $val
        }
    }

    $url = ''
    if ($params.ContainsKey('url')) { $url = $params['url'] }
    if (-not $url) {
        Send-JsonResponse -Context $Context -Data @{ content = $null }
        return
    }

    try {
        $result = Get-Readme -Url $url
        Send-JsonResponse -Context $Context -Data $result
    } catch {
        Send-JsonResponse -Context $Context -Data @{ content = $null }
    }
}

# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------
function Start-LoreServer {
    param([int]$ListenPort)

    # Load HTML template — resolve script directory reliably across PS versions
    $scriptPath = $null
    if ($MyInvocation.PSScriptRoot) {
        $scriptPath = $MyInvocation.PSScriptRoot
    } elseif ($PSCommandPath) {
        $scriptPath = Split-Path -Parent $PSCommandPath
    } elseif ($script:MyInvocation.MyCommand.Path) {
        $scriptPath = Split-Path -Parent $script:MyInvocation.MyCommand.Path
    }
    if (-not $scriptPath) {
        # Last resort: use current working directory
        $scriptPath = (Get-Location).Path
    }
    $htmlTemplatePath = Join-Path $scriptPath 'lore.html'
    if (-not (Test-Path $htmlTemplatePath)) {
        Write-Host "ERROR: lore.html template not found at $htmlTemplatePath" -ForegroundColor Red
        exit 1
    }
    $script:HtmlTemplate = Get-Content $htmlTemplatePath -Raw -Encoding UTF8

    # Create HTTP listener - find a free port
    $actualPort = 0
    $listener = $null

    if ($ListenPort -gt 0) {
        # Specific port requested
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$ListenPort/")
        try {
            $listener.Start()
            $actualPort = $ListenPort
        } catch {
            Write-Host "ERROR: Port $ListenPort is in use: $_" -ForegroundColor Red
            exit 1
        }
    } else {
        # Auto-select a free port from range 58000-58100
        $found = $false
        for ($tryPort = 58000; $tryPort -lt 58100; $tryPort++) {
            try {
                $listener = New-Object System.Net.HttpListener
                $listener.Prefixes.Add("http://localhost:$tryPort/")
                $listener.Start()
                $actualPort = $tryPort
                $found = $true
                break
            } catch {
                # Port in use, try next
                if ($listener) {
                    try { $listener.Close() } catch {}
                }
            }
        }
        if (-not $found) {
            Write-Host "ERROR: Could not find a free port in range 58000-58100" -ForegroundColor Red
            exit 1
        }
    }

    $script:Listener = $listener
    $script:Port = $actualPort
    $baseUrl = "http://localhost:$actualPort"

    Write-Host ""
    Write-Host "  LORE - Lenovo Online Research & Equipment" -ForegroundColor Cyan
    Write-Host "  ==========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Server running at: $baseUrl" -ForegroundColor Green
    Write-Host "  Press Ctrl+C to stop" -ForegroundColor Yellow
    Write-Host ""

    # Open browser
    # Open browser in app mode (no address bar, tabs, etc.)
    try {
        # Try Chrome app mode first
        Start-Process 'chrome' -ArgumentList "--app=$baseUrl", '--disable-translate', '--no-first-run'
    } catch {
        try {
            # Try Edge app mode
            Start-Process 'msedge' -ArgumentList "--app=$baseUrl", '--disable-translate', '--no-first-run'
        } catch {
            # Fallback: default browser
            Start-Process $baseUrl
        }
    }

    # If initial serial provided, add it as a query parameter
    $initialUrl = $baseUrl
    if ($Serial) {
        $initialUrl = "$baseUrl/?serial=$([Uri]::EscapeDataString($Serial))"
    }

    # Prepare HTML with port injected and optional initial serial
    $script:HtmlContent = $script:HtmlTemplate -replace 'var LORE_API = "";', "var LORE_API = `"$baseUrl`";"
    if ($Serial) {
        $script:HtmlContent = $script:HtmlContent -replace 'var INITIAL_SERIAL = "";', "var INITIAL_SERIAL = `"$($Serial -replace '"', '\\"')`";"
    }

    # Request loop - use synchronous GetContext() with timeout via BeginGetContext
    # This avoids the PS 5.1 async bug where GetContextAsync + WaitOne can hang
    try {
        while ($listener.IsListening) {
            $ctx = $null
            try {
                # Use BeginGetContext/EndGetContext with timeout for clean cancellation
                $asyncResult = $listener.BeginGetContext($null, $null)
                $waited = $asyncResult.AsyncWaitHandle.WaitOne(5000)
                if (-not $waited) {
                    # Timeout - check if still listening and continue
                    if (-not $listener.IsListening) { break }
                    continue
                }
                $ctx = $listener.EndGetContext($asyncResult)
            } catch [System.Net.HttpListenerException] {
                if (-not $listener.IsListening) { break }
                Write-Host "Listener error: $_" -ForegroundColor Yellow
                continue
            } catch {
                if (-not $listener.IsListening) { break }
                continue
            }

            if ($null -eq $ctx) { continue }

            $request = $ctx.Request
            $response = $ctx.Response

            # CORS headers
            $response.AddHeader('Access-Control-Allow-Origin', '*')
            $response.AddHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
            $response.AddHeader('Access-Control-Allow-Headers', 'Content-Type')

            # Handle OPTIONS preflight
            if ($request.HttpMethod -eq 'OPTIONS') {
                $response.StatusCode = 204
                $response.OutputStream.Close()
                continue
            }

            $path = $request.Url.AbsolutePath
            $queryString = $request.Url.Query.TrimStart('?')

            try {
                switch -Wildcard ($path) {
                    '/' {
                        # Serve main HTML
                        Send-HtmlResponse -Context $ctx -Html $script:HtmlContent
                    }
                    '/api/search' {
                        Handle-Search -Context $ctx -QueryString $queryString
                    }
                    '/api/browse' {
                        Handle-Browse -Context $ctx -QueryString $queryString
                    }
                    '/api/readme' {
                        Handle-Readme -Context $ctx -QueryString $queryString
                    }
                    default {
                        # Try to serve as a 404
                        $response.StatusCode = 404
                        $response.ContentType = 'text/plain'
                        $msg = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
                        $response.ContentLength64 = $msg.Length
                        $response.OutputStream.Write($msg, 0, $msg.Length)
                        $response.OutputStream.Close()
                    }
                }
            } catch {
                Write-Host "ERROR handling request: $_" -ForegroundColor Red
                try {
                    $ctx.Response.StatusCode = 500
                    $ctx.Response.ContentType = 'application/json; charset=utf-8'
                    $errMsg = [System.Text.Encoding]::UTF8.GetBytes('{"success":false,"error":"Internal server error"}')
                    $ctx.Response.ContentLength64 = $errMsg.Length
                    $ctx.Response.OutputStream.Write($errMsg, 0, $errMsg.Length)
                    $ctx.Response.OutputStream.Close()
                } catch {
                    # Response might already be sent or connection lost
                    try { $ctx.Response.Abort() } catch {}
                }
            }
        }
    } catch {
        if ($_.Exception.Message -notmatch 'Thread exit|application exit|Listener was stopped') {
            Write-Host "Server error: $_" -ForegroundColor Red
        }
    } finally {
        try {
            $listener.Stop()
            $listener.Close()
        } catch {}
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Start-LoreServer -ListenPort $Port