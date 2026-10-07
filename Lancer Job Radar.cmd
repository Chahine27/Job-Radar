@echo off
rem Double-clic : lance Job Radar en arriere-plan, sans fenetre (mise a jour, IA, base de donnees, site). Voir scripts\lancer.ps1
rem Pour arreter : bouton "Arreter Job Radar" en bas du menu du site. Journal : job-radar.log
rem "exit /b" sur la meme ligne : le fichier peut etre remplace par une mise a jour pendant qu'il tourne.
start "" wscript.exe "%~dp0scripts\lancer-cache.vbs" & exit /b
