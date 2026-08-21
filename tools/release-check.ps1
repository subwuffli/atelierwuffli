[CmdletBinding()]
param([switch]$Strict)

$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location $root
$node='C:\Users\wuffl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$failed=$false

function Check($name,[scriptblock]$action){
  try{& $action;Write-Host "OK    $name" -ForegroundColor Green}
  catch{Write-Host "FEHLER $name - $($_.Exception.Message)" -ForegroundColor Red;$script:failed=$true}
}

Check 'JavaScript Live' {& $node --check app.js;if($LASTEXITCODE){throw 'Syntaxfehler'}}
Check 'JavaScript Test' {& $node --check test/app.js;if($LASTEXITCODE){throw 'Syntaxfehler'}}
Check 'Keine fehlerhaften Git-Zeichen' {git diff --check;if($LASTEXITCODE){throw 'Whitespace-Fehler'}}

$liveVersion=(Get-Content VERSION -Raw).Trim()
$testVersion=([regex]::Match((Get-Content test/app.js -Raw),"APP_VERSION='([^']+)'")).Groups[1].Value
if(!$liveVersion -or !$testVersion){throw 'Versionsnummer fehlt'}
Write-Host "INFO  Live: $liveVersion | Test: $testVersion"

$files=@(@('app.js','test/app.js'),@('styles.css','test/styles.css'),@('index.html','test/index.html'))
foreach($pair in $files){
  git diff --no-index --quiet -- $pair[0] $pair[1]
  if($LASTEXITCODE -eq 1){Write-Host "HINWEIS Unterschied Test/Live: $($pair[0])" -ForegroundColor Yellow}
}

$testMigrations=Get-ChildItem supabase\test-*.sql -ErrorAction SilentlyContinue
$liveMigrations=Get-ChildItem supabase\live-*.sql -ErrorAction SilentlyContinue
Write-Host "INFO  Migrationen: Test $($testMigrations.Count) | Live $($liveMigrations.Count)"
if(!$liveMigrations.Count){Write-Host 'FEHLER Keine Live-Migrationen dokumentiert.' -ForegroundColor Red;$failed=$true}

$contract=Get-Content tools\release-contract.json -Raw | ConvertFrom-Json
foreach($feature in $contract.features){
  foreach($marker in @($feature.app|Where-Object {$_})){if((Select-String -Path test\app.js -SimpleMatch $marker -Quiet) -and !(Select-String -Path app.js -SimpleMatch $marker -Quiet)){Write-Host "FEHLER $($feature.name): App-Merkmal fehlt in Live ($marker)" -ForegroundColor Red;$failed=$true}}
  foreach($marker in @($feature.css|Where-Object {$_})){if((Select-String -Path test\styles.css -SimpleMatch $marker -Quiet) -and !(Select-String -Path styles.css -SimpleMatch $marker -Quiet)){Write-Host "FEHLER $($feature.name): CSS-Merkmal fehlt in Live ($marker)" -ForegroundColor Red;$failed=$true}}
  if($feature.testMigration -and (Test-Path "supabase\$($feature.testMigration)") -and !(Test-Path "supabase\$($feature.liveMigration)")){Write-Host "FEHLER $($feature.name): Live-Migration fehlt ($($feature.liveMigration))" -ForegroundColor Red;$failed=$true}
}

if($failed){
  Write-Host 'STOP: Erst Unterschiede und benoetigte Live-SQL-Migrationen pruefen. Kein Live-Deploy.' -ForegroundColor Yellow
  if($Strict){exit 1}
}else{Write-Host 'BEREIT: Technische Vorpruefung bestanden.' -ForegroundColor Green}
