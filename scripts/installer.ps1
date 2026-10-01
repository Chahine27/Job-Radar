# Installeur de Job Radar (Windows 10 / 11). Lancé par « Installer Job Radar.cmd » à la racine du projet.
# On peut le relancer autant de fois que nécessaire : ce qui est déjà installé ou configuré est gardé.
# « Continue » : avec « Stop », Windows PowerShell 5 s'arrête dès qu'un programme écrit sur sa sortie d'erreur.
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Installation de Job Radar"
Set-Location (Split-Path -Parent $PSScriptRoot)
$root = Get-Location
$model = "gemma4:e4b"
$pnpmVersion = "12.6.0"

function Step($n, $text) { Write-Host ""; Write-Host "[$n/8] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  OK : $text" -ForegroundColor Green }
function Info($text) { Write-Host "  $text" }
function Warn($text) { Write-Host "  ATTENTION : $text" -ForegroundColor Yellow }
function Fail($text) {
  Write-Host ""
  Write-Host "PROBLÈME : $text" -ForegroundColor Red
  Write-Host "Corrige ce point puis relance « Installer Job Radar.cmd » : ce qui est déjà fait sera gardé." -ForegroundColor Yellow
  Read-Host "Appuie sur Entrée pour fermer"
  exit 1
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
# Après une installation, Windows ne met pas à jour le PATH de cette fenêtre : on le relit.
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function WingetInstall($id, $label) {
  Info "Installation de $label (une fenêtre Windows peut demander ton accord)..."
  winget install -e --id $id --accept-package-agreements --accept-source-agreements --silent
  RefreshPath
}
function Responds($address) {
  try { Invoke-WebRequest $address -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
function NewSecret($bytes) {
  $b = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString("x2") })
}

Write-Host "=== Installation de Job Radar ===" -ForegroundColor Cyan
Write-Host "Dossier : $root"
Write-Host "Compte environ 15 à 30 minutes la première fois (téléchargements)."

# 1. Le PC
Step 1 "Vérification du PC"
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$drive = (Get-Item $root).PSDrive
$freeGb = [math]::Round($drive.Free / 1GB)
Info "Mémoire : $ramGb Go · Espace libre sur le disque $($drive.Name) : $freeGb Go"
if ($ramGb -lt 8) { Warn "moins de 8 Go de mémoire : l'IA locale sera très lente, voire impossible." }
if ($freeGb -lt 12) { Warn "moins de 12 Go libres : Docker et le modèle d'IA risquent de manquer de place." }
if (-not (Has winget)) {
  Fail "l'outil « winget » est absent. Installe « Programme d'installation d'application » (App Installer) depuis le Microsoft Store, puis relance."
}
Ok "PC compatible"

# 2. Node.js et pnpm
Step 2 "Node.js et pnpm (pour faire tourner le site)"
if (-not (Has node)) { WingetInstall "OpenJS.NodeJS.LTS" "Node.js" }
if (-not (Has node)) { Fail "Node.js ne s'est pas installé. Redémarre le PC puis relance l'installeur." }
Ok "Node.js $(node -v)"
$pnpmOk = (Has pnpm) -and ((pnpm -v) -eq $pnpmVersion)
if (-not $pnpmOk) {
  Info "Installation de pnpm $pnpmVersion..."
  npm install -g "pnpm@$pnpmVersion" | Out-Null
  RefreshPath
}
if (-not (Has pnpm)) { Fail "pnpm ne s'est pas installé (npm install -g pnpm@$pnpmVersion)." }
Ok "pnpm $(pnpm -v)"

# 3. Docker Desktop (base de données)
Step 3 "Docker Desktop (pour la base de données)"
$dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerExe)) {
  WingetInstall "Docker.DockerDesktop" "Docker Desktop"
  if (-not (Test-Path $dockerExe)) { Fail "Docker Desktop ne s'est pas installé." }
  Warn "Docker Desktop vient d'être installé : Windows demande souvent un REDÉMARRAGE."
  Warn "Redémarre le PC, ouvre Docker Desktop une fois (accepte les conditions), puis relance l'installeur."
  Read-Host "Appuie sur Entrée pour fermer"
  exit 0
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Info "Démarrage de Docker Desktop (jusqu'à 3 minutes)..."
  Start-Process $dockerExe
  $ok = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  }
  if (-not $ok) {
    Fail "Docker ne démarre pas. Ouvre Docker Desktop, accepte les conditions et attends « Engine running ». S'il parle de WSL ou de virtualisation : redémarre le PC (et active la virtualisation dans le BIOS si Docker le demande)."
  }
}
Ok "Docker est prêt"

# 4. Ollama et le modèle d'IA
Step 4 "IA locale (Ollama + modèle $model, environ 3 Go)"
$ollamaApp = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
if (-not (Has ollama) -and -not (Test-Path $ollamaApp)) { WingetInstall "Ollama.Ollama" "Ollama" }
if (-not (Has ollama)) { Fail "Ollama ne s'est pas installé. Installe-le depuis https://ollama.com puis relance." }
if (-not (Responds "http://127.0.0.1:11434/api/version")) {
  if (Test-Path $ollamaApp) { Start-Process $ollamaApp } else { Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden }
  for ($i = 0; $i -lt 30 -and -not (Responds "http://127.0.0.1:11434/api/version"); $i++) { Start-Sleep -Seconds 1 }
}
$models = (ollama list) -join "`n"
if ($models -notmatch [regex]::Escape($model)) {
  Info "Téléchargement du modèle d'IA (peut prendre plusieurs minutes)..."
  ollama pull $model
  if ($LASTEXITCODE -ne 0) { Fail "le téléchargement du modèle $model a échoué (connexion ?)." }
}
Ok "IA locale prête ($model)"

# 5. Fichier de réglages .env
Step 5 "Réglages (.env)"
if (Test-Path ".env") {
  Ok ".env déjà présent : gardé tel quel"
} else {
  $lines = Get-Content ".env.example" -Encoding UTF8
  function SetKey($key, $value) {
    $script:lines = $script:lines | ForEach-Object { if ($_ -match "^$key=") { "$key=$value" } else { $_ } }
  }
  $dbPassword = NewSecret 18
  SetKey "POSTGRES_PASSWORD" $dbPassword
  SetKey "DATABASE_URL" "postgresql://jobradar:$dbPassword@localhost:5432/jobradar"
  SetKey "SESSION_SECRET" (NewSecret 32)
  Write-Host ""
  Write-Host "  Crée ton compte Job Radar (il sert seulement à te connecter au site, sur ce PC) :" -ForegroundColor Cyan
  do { $email = (Read-Host "  Ton adresse email").Trim().ToLower() } while ($email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$")
  do {
    $p1 = [Net.NetworkCredential]::new("", (Read-Host "  Choisis un mot de passe (12 caractères minimum)" -AsSecureString)).Password
    $p2 = [Net.NetworkCredential]::new("", (Read-Host "  Retape-le" -AsSecureString)).Password
    $bad = $p1 -match '["\\]'
    if ($p1.Length -lt 12) { Warn "trop court (12 caractères minimum)." }
    elseif ($bad) { Warn 'évite les caractères " et \ dans le mot de passe.' }
    elseif ($p1 -ne $p2) { Warn "les deux mots de passe sont différents." }
  } while ($p1.Length -lt 12 -or $bad -or $p1 -ne $p2)
  SetKey "SEED_USER_EMAIL" $email
  SetKey "SEED_USER_PASSWORD" ('"' + $p1 + '"') # entre guillemets : un # ou un espace dans le mot de passe reste valable
  SetKey "NOTIFY_EMAIL_TO" $email
  [IO.File]::WriteAllLines((Join-Path $root ".env"), $lines, (New-Object Text.UTF8Encoding $false))
  Ok ".env créé (mots de passe internes générés automatiquement)"
}

# 6. Modules du site
Step 6 "Modules du site (pnpm install, quelques minutes)"
pnpm install
if ($LASTEXITCODE -ne 0) { Fail "pnpm install a échoué (connexion internet ?)." }
Ok "Modules installés"

# 7. Base de données
Step 7 "Base de données"
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { Fail "la base de données ne démarre pas (docker compose up)." }
pnpm --filter @job-radar/db migrate:deploy
if ($LASTEXITCODE -ne 0) { Fail "la création des tables a échoué (migrate deploy)." }
pnpm db:generate | Out-Null
pnpm db:seed
if ($LASTEXITCODE -ne 0) { Fail "la création de ton compte a échoué (db:seed)." }
Ok "Base de données prête"

# 8. Raccourci Bureau
Step 8 "Raccourci « Job Radar » sur le Bureau"
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$target = Join-Path $root "Lancer Job Radar.cmd"
$lnkPath = Join-Path $desktop "Job Radar.lnk"
# Un raccourci « Job Radar » vers une AUTRE copie existe déjà : on ne l'écrase pas.
if ((Test-Path $lnkPath) -and $shell.CreateShortcut($lnkPath).TargetPath -ne $target) {
  $lnkPath = Join-Path $desktop ("Job Radar (" + (Split-Path -Leaf $root) + ").lnk")
}
$link = $shell.CreateShortcut($lnkPath)
$link.TargetPath = Join-Path $root "Lancer Job Radar.cmd"
$link.WorkingDirectory = "$root"
$link.IconLocation = (Join-Path $root "scripts\job-radar.ico") + ",0"
$link.Description = "Lance Job Radar (Docker, IA locale et site)"
$link.Save()
Ok "Raccourci créé"

Write-Host ""
Write-Host "=== Installation terminée ===" -ForegroundColor Green
Write-Host "Pour lancer Job Radar : double-clic sur « Job Radar » (Bureau)."
Write-Host "Connecte-toi avec l'email et le mot de passe que tu viens de choisir."
$go = Read-Host "Lancer Job Radar maintenant ? (O/n)"
if ($go -notmatch "^[nN]") { Start-Process (Join-Path $root "Lancer Job Radar.cmd") }
