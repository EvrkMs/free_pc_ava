param(
    [Parameter(Mandatory=$true)][string]$Thumbprint,
    [Parameter(Mandatory=$true)][string]$PHPSESSID,
    [Parameter(Mandatory=$true)][string]$BaseHost,
    [Parameter(Mandatory=$true)][string]$UuidsJson,
    [int]$TimeoutMs = 6000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {

$uuids = $UuidsJson | ConvertFrom-Json
if ($uuids -isnot [System.Array]) { $uuids = @($uuids) }
$cert = Get-Item "Cert:\CurrentUser\My\$Thumbprint"

$rand = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
$sessionId = "$PHPSESSID`_$rand"

$ws = New-Object System.Net.WebSockets.ClientWebSocket
[void]$ws.Options.ClientCertificates.Add($cert)
$ws.Options.Proxy = $null
$ws.Options.SetRequestHeader("Cookie", "PHPSESSID=$PHPSESSID")
$ws.Options.SetRequestHeader("Origin", "https://$BaseHost")

$uri = New-Object System.Uri("wss://$BaseHost/wss/?client_guid=$sessionId&type_client=browser")
$connectCts = New-Object System.Threading.CancellationTokenSource
$connectCts.CancelAfter(8000)
[void]$ws.ConnectAsync($uri, $connectCts.Token).GetAwaiter().GetResult()

foreach ($uuid in $uuids) {
    $msg = @{ client_guid = $uuid; type = "command_api"; command = "showConfig"; who_send = $sessionId; need_return = $true } | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
    $seg = New-Object System.ArraySegment[byte] (, $bytes)
    [void]$ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
    Start-Sleep -Milliseconds 200
}

$results = @{}
$buffer = New-Object byte[] 262144
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)

while ((Get-Date) -lt $deadline -and $results.Count -lt $uuids.Count) {
    $remainingMs = [Math]::Max(200, ($deadline - (Get-Date)).TotalMilliseconds)
    $recvCts = New-Object System.Threading.CancellationTokenSource
    $recvCts.CancelAfter([int]$remainingMs)
    try {
        $ms = New-Object System.IO.MemoryStream
        do {
            $recvSeg = New-Object System.ArraySegment[byte] (, $buffer)
            $result = $ws.ReceiveAsync($recvSeg, $recvCts.Token).GetAwaiter().GetResult()
            $ms.Write($buffer, 0, $result.Count)
        } while (-not $result.EndOfMessage)
        $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())

        # Полный ConvertFrom-Json на этих сообщениях ненадёжен: в payload реальных
        # устройств встречаются ключи, различающиеся только регистром
        # (BlockUsbStor / blockUsbStor) — PS 5.1 такой JSON не парсит вообще
        # ("словарь содержит повторяющиеся ключи"). Поэтому вытаскиваем только
        # нужные поля точечными регексами.
        function Get-JsonStringField($s, $name) {
            $m = [regex]::Match($s, '"' + $name + '"\s*:\s*"([^"]*)"')
            if ($m.Success) { return $m.Groups[1].Value } else { return $null }
        }
        function Get-JsonRawField($s, $name) {
            $m = [regex]::Match($s, '"' + $name + '"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)')
            if ($m.Success) { return $m.Groups[1].Value } else { return $null }
        }

        $uuid = Get-JsonStringField $text 'UUID'
        if ($uuid) {
            $results[$uuid] = [PSCustomObject]@{
                UUID           = $uuid
                state          = Get-JsonStringField $text 'state'
                endOfTimeText  = Get-JsonStringField $text 'endOfTimeText'
                remainTime     = Get-JsonRawField $text 'remainTime'
                isLock         = Get-JsonRawField $text 'isLock'
                guest_id       = Get-JsonRawField $text 'guest_id'
                old_guest_id   = Get-JsonRawField $text 'old_guest_id'
                tehnicalTime   = Get-JsonRawField $text 'tehnicalTime'
                is_admin_pc    = Get-JsonRawField $text 'is_admin_pc'
                is_OfflineMode = Get-JsonRawField $text 'is_OfflineMode'
            }
        }
    } catch [System.OperationCanceledException] {
        # обычный таймаут одного ожидания — пробуем ещё, пока не истёк общий дедлайн
        continue
    } catch {
        break
    }
}

try {
    [void]$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
} catch {}

$out = @()
foreach ($k in $results.Keys) { $out += $results[$k] }
Write-Output (ConvertTo-Json -InputObject $out -Compress -Depth 5)

} catch {
    [Console]::Error.WriteLine("FATAL: " + $_.Exception.ToString())
    exit 1
}
