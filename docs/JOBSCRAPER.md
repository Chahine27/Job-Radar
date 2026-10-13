# ESSAI — JobScraper (LinkedIn, HelloWork, Welcome to the Jungle)

> Branche d'essai `essai-jobscraper`, pas la version pour tous : il faut installer Python à part, et LinkedIn interdit
> dans ses conditions d'utilisation la collecte automatique de ses offres. À utiliser à tes risques, pour toi seul.

JobScraper est un outil Python externe (https://github.com/Zeffut/JobScraper, sans licence publiée : il n'est donc pas
recopié dans Job Radar). Job Radar l'appelle pour chaque recherche du profil, lit son export JSON, puis les offres suivent
le chemin normal (lecture, dédoublonnage, score, notifications). Trois sources, désactivées par défaut :
`jobscraper:linkedin`, `jobscraper:hellowork`, `jobscraper:wttj`. Au plus 25 offres par recherche ; 20 minutes minimum
entre deux collectes (en dessous, les sites risquent de bloquer ton adresse IP).

## Installation (une seule fois)

1. Installe Python 3.12 depuis https://www.python.org (coche « Add python.exe to PATH »).
2. Dans le dossier de Job Radar, ouvre PowerShell et tape, une ligne après l'autre :

```powershell
git clone https://github.com/Zeffut/JobScraper.git tools/jobscraper
py -3 -m venv tools/jobscraper/.venv
tools/jobscraper/.venv/Scripts/python.exe -m pip install -e tools/jobscraper
```

3. Dans `.env`, mets `JOBSCRAPER_ENABLED=true` (les autres réglages ont une valeur par défaut, voir `.env.example`).
4. Vérifie : `pnpm jobscraper:test` → une ligne par site avec `"status":"OK"` et le nombre d'offres trouvées
   (recherche « développeur » à Paris, rien n'est enregistré).
5. Relance Job Radar, puis page **Sources** : active les sites voulus, un à la fois.

## Welcome to the Jungle : sans JobScraper

JobScraper ignorait la date et le tri pour WTTJ (il renvoyait de vieilles offres, écartées ensuite). La source
`jobscraper:wttj` interroge maintenant directement l'index de recherche public du site, trié par date, avec l'expression
exacte des mots-clés. Python n'est plus nécessaire pour cette source. Le télétravail partiel compte comme hybride.

## Indeed (JobSpy)

JobScraper ne couvre pas Indeed. La source `jobscraper:indeed` lance à la place `packages/source-connectors/python/indeed.py`,
qui utilise JobSpy (`python-jobspy`, licence MIT). Pour l'installer, dans le même environnement Python :

```powershell
tools/jobscraper/.venv/Scripts/python.exe -m pip install python-jobspy
```

Le salaire est converti en annuel (mensuel ×12, journalier ×218, horaire ×1607). Le lieu est passé au format d'Indeed
« Nom (département) ». Puis page **Sources** : active « JobScraper · Indeed ».

## Ce qui n'est pas repris de la version perso

File de collecte séparée, complétion des descriptions depuis les pages publiques, offres LinkedIn closes passées en
« Expirée ». Si une recherche ne renvoie rien alors que le site bloque l'IP (captcha, page de connexion), la source
s'arrête avec un message clair au lieu de compter 0 offre.
