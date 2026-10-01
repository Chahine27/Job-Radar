# Crée le raccourci « Job Radar » sur le Bureau (à lancer une seule fois : clic droit → « Exécuter avec PowerShell »).
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "Job Radar.lnk"))
$link.TargetPath = Join-Path $root "Lancer Job Radar.cmd"
$link.WorkingDirectory = $root
$link.IconLocation = (Join-Path $PSScriptRoot "job-radar.ico") + ",0"
$link.Description = "Lance Job Radar (base de données, IA locale et site)"
$link.Save()
Write-Host "Raccourci « Job Radar » créé sur le Bureau." -ForegroundColor Green
Write-Host "Astuce : clic droit dessus → « Épingler à la barre des tâches » (ou « Afficher d'autres options » sous Windows 11)."
Read-Host "Appuie sur Entrée pour fermer"
