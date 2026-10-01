# Lance Job Radar en un double-clic : mise à jour du programme, Ollama (IA), modules, base de données (intégrée, sans Docker), puis « pnpm dev ».
# Appelé par « Lancer Job Radar.cmd » à la racine du projet. Fermer cette fenêtre (ou Ctrl + C) arrête l'appli.
# « Continue » : avec « Stop », Windows PowerShell 5 s'arrête dès qu'un programme écrit sur sa sortie d'erreur.
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Job Radar"
Set-Location (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot "db.ps1")
$url = "http://localhost:5173"

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) {
  Write-Host ""
  Write-Host "PROBLÈME : $text" -ForegroundColor Red
  Read-Host "Appuie sur Entrée pour fermer"
  exit 1
}
function Responds($address) {
  try { Invoke-WebRequest $address -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

# 0. Déjà lancé ? On ouvre juste le site.
if (Responds $url) {
  Write-Host "Job Radar tourne déjà : ouverture du site." -ForegroundColor Green
  Start-Process $url
  Start-Sleep -Seconds 2
  exit 0
}

if (-not (Test-Path ".env")) { Fail "le fichier .env est introuvable dans $(Get-Location)." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "pnpm est introuvable. Installe Node.js puis pnpm (voir docs/LANCEMENT.md)." }

# 0 bis. Mise à jour automatique : dernière version publiée sur GitHub (« Releases »). Ne bloque jamais le lancement.
if (-not $env:JOBRADAR_UPDATED) {
  Step "Recherche de mise à jour"
  node scripts\update.mjs
  if ($LASTEXITCODE -eq 10) {
    # Nouvelle version installée : on relance le lanceur à jour (il installe les modules et met la base à jour).
    Write-Host "Redémarrage avec la nouvelle version..." -ForegroundColor Green
    $env:JOBRADAR_UPDATED = "1"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "lancer.ps1")
    exit $LASTEXITCODE
  }
}

# 1. Ollama (IA locale) : lancé s'il ne tourne pas. Pas bloquant : l'appli marche sans.
Step "IA locale (Ollama)"
if (Responds "http://127.0.0.1:11434/api/version") {
  Write-Host "Ollama tourne déjà." -ForegroundColor Green
} else {
  $ollamaApp = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
  if (Test-Path $ollamaApp) {
    Start-Process $ollamaApp
    Write-Host "Ollama démarre." -ForegroundColor Green
  } elseif (Get-Command ollama -ErrorAction SilentlyContinue) {
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
    Write-Host "Ollama démarre." -ForegroundColor Green
  } else {
    Write-Host "Ollama introuvable : l'IA sera indisponible (le reste marche)." -ForegroundColor Yellow
  }
}

# 2. Après une mise à jour du code : modules et base de données à jour
Step "Mises à jour et base de données"
$stamp = "node_modules\.modules.yaml"
if (-not (Test-Path $stamp) -or (Get-Item "pnpm-lock.yaml").LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
  Write-Host "Installation des modules (pnpm install)..."
  pnpm install
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install a échoué." }
}
# Base de données intégrée : démarrée en arrière-plan (invisible) si elle ne tourne pas déjà.
if (-not (StartDatabase)) { Fail "la base de données ne démarre pas. Regarde le fichier data\postgres.log pour le détail." }
pnpm --filter @job-radar/db migrate:deploy
if ($LASTEXITCODE -ne 0) { Fail "la mise à jour de la base de données a échoué (migrate deploy)." }
pnpm db:generate | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "prisma generate a échoué." }
Write-Host "Tout est à jour." -ForegroundColor Green

# 3. Ouvre le site dès qu'il répond (en arrière-plan), puis lance l'appli dans cette fenêtre
Start-Job -ArgumentList $url -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 90; $i++) {
    try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; return } catch { Start-Sleep -Seconds 1 }
  }
} | Out-Null

Step "Job Radar démarre ($url s'ouvrira tout seul)"
Write-Host "Laisse cette fenêtre ouverte : la collecte et les alertes tournent tant qu'elle est ouverte." -ForegroundColor Yellow
Write-Host "Pour arrêter : ferme la fenêtre (ou Ctrl + C)." -ForegroundColor Yellow
pnpm dev
Read-Host "Job Radar est arrêté. Appuie sur Entrée pour fermer"
