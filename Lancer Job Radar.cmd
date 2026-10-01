@echo off
rem Double-clic : lance Job Radar (mise a jour, IA, base de donnees, site). Voir scripts\lancer.ps1
rem "exit /b" sur la meme ligne : le fichier peut etre remplace par une mise a jour pendant qu'il tourne.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\lancer.ps1" & exit /b
