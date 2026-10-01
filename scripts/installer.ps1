# Installeur de Job Radar (Windows 10 / 11). Lancé par « Installer Job Radar.cmd » à la racine du projet.
# On peut le relancer autant de fois que nécessaire : ce qui est déjà installé ou configuré est gardé.
# Pas de Docker : la base de données (PostgreSQL) est intégrée au projet, invisible, sans compte.
# « Continue » : avec « Stop », Windows PowerShell 5 s'arrête dès qu'un programme écrit sur sa sortie d'erreur.
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Installation de Job Radar"
Set-Location (Split-Path -Parent $PSScriptRoot)
$root = Get-Location
. (Join-Path $PSScriptRoot "db.ps1")
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
Write-Host "Compte environ 10 à 20 minutes la première fois (téléchargements)."

# 1. Le PC
Step 1 "Vérification du PC"
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$drive = (Get-Item $root).PSDrive
$freeGb = [math]::Round($drive.Free / 1GB)
Info "Mémoire : $ramGb Go · Espace libre sur le disque $($drive.Name) : $freeGb Go"
if ($ramGb -lt 8) { Warn "moins de 8 Go de mémoire : l'IA locale sera très lente, voire impossible." }
if ($freeGb -lt 8) { Warn "moins de 8 Go libres : le modèle d'IA et la base risquent de manquer de place." }
if (-not (Has winget)) {
  Fail "l'outil « winget » est absent. Installe « Programme d'installation d'application » (App Installer) depuis le Microsoft Store, puis relance."
}
Ok "PC compatible"

# 2. Fichier de réglages .env (en premier : rien ne marche sans lui)
Step 2 "Réglages (.env)"
if (Test-Path ".env") {
  Ok ".env déjà présent : gardé tel quel"
} else {
  if (-not (Test-Path ".env.example")) { Fail "le fichier .env.example est introuvable dans $root (projet incomplet ?)." }
  $lines = Get-Content ".env.example" -Encoding UTF8
  function SetKey($key, $value) {
    $script:lines = $script:lines | ForEach-Object { if ($_ -match "^$key=") { "$key=$value" } else { $_ } }
  }
  $dbPassword = NewSecret 18
  SetKey "DATABASE_URL" "postgresql://jobradar:$dbPassword@127.0.0.1:5433/jobradar"
  SetKey "SESSION_SECRET" (NewSecret 32)
  [IO.File]::WriteAllLines((Join-Path $root ".env"), $lines, (New-Object Text.UTF8Encoding $false))
  if (-not (Test-Path ".env")) { Fail "impossible d'écrire le fichier .env dans $root (dossier protégé ? Mets le projet dans Documents)." }
  Ok ".env créé (mot de passe de la base généré automatiquement)"
}

# 3. Node.js et pnpm
Step 3 "Node.js et pnpm (pour faire tourner le site)"
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

# 4. Bibliothèques Microsoft utilisées par la base de données (déjà présentes sur la plupart des PC)
Step 4 "Composants Windows pour la base de données"
$vc = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" -ErrorAction SilentlyContinue
if (-not $vc -or $vc.Installed -ne 1) { WingetInstall "Microsoft.VCRedist.2015+.x64" "Microsoft Visual C++ (bibliothèques Windows)" }
Ok "Composants présents"

# 5. Ollama et le modèle d'IA
Step 5 "IA locale (Ollama + modèle $model, environ 3 Go)"
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

# 6. Modules du site
Step 6 "Modules du site (pnpm install, quelques minutes)"
pnpm install
if ($LASTEXITCODE -ne 0) { Fail "pnpm install a échoué : le message juste au-dessus dit pourquoi (envoie-en une photo si besoin)." }
Ok "Modules installés"

# 7. Base de données (intégrée, fichiers dans le dossier data\)
Step 7 "Base de données"
if (-not (StartDatabase)) { Fail "la base de données ne démarre pas. Regarde le fichier data\postgres.log pour le détail." }
pnpm --filter @job-radar/db migrate:deploy
if ($LASTEXITCODE -ne 0) { Fail "la création des tables a échoué (migrate deploy)." }
pnpm db:generate | Out-Null
pnpm db:seed
if ($LASTEXITCODE -ne 0) { Fail "le remplissage de la base a échoué (db:seed)." }
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
$link.TargetPath = $target
$link.WorkingDirectory = "$root"
$link.IconLocation = (Join-Path $root "scripts\job-radar.ico") + ",0"
$link.Description = "Lance Job Radar (base de données, IA locale et site)"
$link.Save()
Ok "Raccourci créé"

Write-Host ""
Write-Host "=== Installation terminée ===" -ForegroundColor Green
Write-Host "Pour lancer Job Radar : double-clic sur « Job Radar » (Bureau)."
Write-Host "Au premier lancement, le site te demande de créer ton compte puis de déposer ton CV :"
Write-Host "l'IA locale le lit et prépare ton profil (métiers, compétences, ville)."
$go = Read-Host "Lancer Job Radar maintenant ? (O/n)"
if ($go -notmatch "^[nN]") { Start-Process (Join-Path $root "Lancer Job Radar.cmd") }
