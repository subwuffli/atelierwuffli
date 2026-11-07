[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply,[switch]$VerifyOnly)

$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location $root

function Read-Text($path){[System.IO.File]::ReadAllText((Join-Path $root $path))}
function Require-Match($text,$pattern,$label){
  $match=[regex]::Match($text,$pattern)
  if(!$match.Success){throw "$label fehlt."}
  $match.Value
}

$liveApp=Read-Text 'app.js'
$testApp=Read-Text 'test/app.js'
$liveIndex=Read-Text 'index.html'
$testIndex=Read-Text 'test/index.html'
$testStyles=Read-Text 'test/styles.css'

# The credentials stay in Live; only the tested application code is promoted.
$liveUrl=Require-Match $liveApp "const SUPABASE_URL='[^']+';" 'Live-Supabase-URL'
$liveKey=Require-Match $liveApp "const SUPABASE_KEY='[^']+';" 'Live-Supabase-Key'
$liveCsp=Require-Match $liveIndex '<meta http-equiv="Content-Security-Policy" content="[^"]+">' 'Live-CSP'
$liveTitle=Require-Match $liveIndex '<title>[^<]+</title>' 'Live-Titel'

$app=[regex]::Replace($testApp,"const SUPABASE_URL='[^']+';",$liveUrl,1)
$app=[regex]::Replace($app,"const SUPABASE_KEY='[^']+';",$liveKey,1)
$app=[regex]::Replace($app,"const APP_VERSION='TEST ([^']+)';",'const APP_VERSION=''$1'';',1)
if($app -match 'xiqbveuuhngeosqetfuo|TEST V'){throw 'Test-Konfiguration ist noch in der Live-App enthalten.'}
$version=([regex]::Match($app,"const APP_VERSION='([^']+)';")).Groups[1].Value
if(!$version){throw 'Live-Version konnte nicht erzeugt werden.'}

$styles=[regex]::Replace($testStyles,'(?m)^\.test-environment-banner\{.*\}\r?\n?','',1)
$styles=$styles -replace '\.test-environment\s+',''
if($styles -match 'test-environment'){throw 'Test-Banner-CSS ist noch im Live-Design enthalten.'}

$index=[regex]::Replace($testIndex,'<meta http-equiv="Content-Security-Policy" content="[^"]+">',$liveCsp,1)
$index=[regex]::Replace($index,'<title>[^<]+</title>',$liveTitle,1)
$index=$index -replace '<body class="test-environment">','<body>'
$index=[regex]::Replace($index,'\s*<div class="test-environment-banner" role="status">.*?</div>\r?\n','',1)
$index=$index -replace '>TEST (V\d+\.\d+\.\d+\.\d+)<','>$1<'
if($index -match 'test-environment|TESTUMGEBUNG|xiqbveuuhngeosqetfuo'){throw 'Test-Konfiguration ist noch im Live-HTML enthalten.'}

$node=(Get-Command node -ErrorAction Stop).Source
$temp=Join-Path ([System.IO.Path]::GetTempPath()) "atelier-wuffli-promote-$PID.js"
try{
  [System.IO.File]::WriteAllText($temp,$app)
  & $node --check $temp
  if($LASTEXITCODE){throw 'Die erzeugte Live-App hat einen Syntaxfehler.'}
}finally{Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue -WhatIf:$false}

Write-Host 'OK    Test-Artefakte lassen sich sicher für Live erzeugen.' -ForegroundColor Green
if($VerifyOnly){exit 0}
if(!$Apply){Write-Host 'Vorschau beendet. Für die Übernahme: .\tools\promote-test-to-live.ps1 -Apply' -ForegroundColor Yellow;exit 0}

if($PSCmdlet.ShouldProcess('Live-Frontend','geprüften Teststand übernehmen')){
  [System.IO.File]::WriteAllText((Join-Path $root 'app.js'),$app)
  [System.IO.File]::WriteAllText((Join-Path $root 'styles.css'),$styles)
  [System.IO.File]::WriteAllText((Join-Path $root 'index.html'),$index)
  [System.IO.File]::WriteAllText((Join-Path $root 'VERSION'),"$version`n")
  Write-Host 'BEREIT: Live-Frontend wurde aus dem geprüften Teststand erzeugt. Danach Release-Check, Migrationen und Deploy ausführen.' -ForegroundColor Green
}
