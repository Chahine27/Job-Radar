# Job Radar — mode d'emploi

Ce guide explique comment démarrer l'appli, l'utiliser au quotidien et réparer les problèmes courants.
Toutes les commandes se tapent dans un terminal ouvert dans le dossier `jobRadar`.

## 0. Première installation

1. Télécharge le projet et décompresse-le où tu veux (par exemple `Documents\jobRadar`).
2. Double-clic sur **« Installer Job Radar.cmd »**. Il crée d'abord les réglages (`.env`, mot de passe de la base généré
   tout seul), puis installe ce qui manque : Node.js, pnpm, Ollama et le modèle d'IA. Il crée ensuite la base
   de données et le raccourci « Job Radar » sur le Bureau.
3. Pas de Docker : la base de données est intégrée au projet (dossier `data\`), invisible, sans compte à créer sur internet.
   Si l'installation s'arrête, corrige le point indiqué et relance l'installeur : ce qui est déjà fait est gardé.
4. **Premier lancement** : le site s'ouvre sur l'écran « Bienvenue ».
   - Crée ton compte (email + mot de passe de 12 caractères minimum). Il protège seulement ton espace sur ce PC.
   - Dépose ton CV (PDF, Word .docx ou texte). Un CV scanné (image) ne contient pas de texte : colle alors son texte.
   - L'IA locale lit ton CV (30 s à 2 min) et propose : métiers à rechercher, compétences, ville, années d'expérience, contrats.
   - **Codes métier** : Job Radar propose jusqu'à 5 métiers de la liste officielle de France Travail (avec leur code, ex. « Aide-soignant · J1501 »).
     Ils servent à la page « Entreprises » (candidatures spontanées). Retire ceux qui ne vont pas, ou cherches-en un autre.
     Avec les clés France Travail (API ROMEO), la proposition vient de France Travail ; sinon l'IA de ton PC choisit dans la liste officielle.
   - Corrige ce qui ne va pas, clique sur l'étoile des compétences que tu maîtrises vraiment, puis « C'est bon, lancer la recherche ».
     La zone des candidatures spontanées est mise sur la ville de ton CV (30 km, modifiable ensuite).
   - Si Ollama ne répond pas : ouvre l'appli Ollama puis « Réessayer », ou « Remplir à la main ».
   - Le dernier écran propose d'aller dans **Réglages** pour ajouter les clés des sites d'offres.
   Tout reste modifiable ensuite dans « Profil » et « CV & lettre ».
5. **Réglages** (menu à gauche) : une carte par service — France Travail, Adzuna, Jooble, Email (Gmail), Transports en Île-de-France.
   Chaque carte explique à quoi sert le service et comment obtenir la clé gratuite (« Comment obtenir la clé ? »).
   Colle la clé, clique **Enregistrer** (pris en compte tout de suite, sans relancer), puis **Tester**.
   Il faut au moins France Travail, Adzuna ou Jooble pour recevoir des offres. Tu n'as jamais besoin d'ouvrir le fichier `.env`.

## 1. Après un redémarrage du PC

**Le plus simple : double-clic sur « Lancer Job Radar.cmd »** (à la racine de `jobRadar`), ou sur le raccourci « Job Radar » du Bureau.
Il vérifie d'abord s'il existe une nouvelle version de Job Radar et l'installe toute seule (voir « 3. Mises à jour »). Il démarre ensuite la base de données (en arrière-plan, invisible), Ollama, installe les mises à jour (`pnpm install` si besoin,
migrations de la base), lance `pnpm dev` et ouvre http://localhost:5173 tout seul. Si Job Radar tourne déjà, il arrête l'ancienne version et relance tout (pour toujours avoir la dernière version). Si le port 5173 ou 3000 est pris par un autre programme, il le dit et indique lequel.
Tout tourne **en arrière-plan, sans fenêtre**. Pour arrêter : bouton **Arrêter Job Radar** en bas du menu du site.
Un problème au démarrage s'affiche dans une petite fenêtre ; le détail de ce qui se passe est dans le fichier `job-radar.log`.
Une source en erreur ? Page **Réglages** → carte « Relancer une source ».
Pour créer le raccourci du Bureau (une seule fois) : clic droit sur `scripts\creer-raccourci.ps1` → « Exécuter avec PowerShell ».

À la main, si besoin :

1. Démarre la base de données (laisse cette fenêtre ouverte) :
   ```
   pnpm db:server
   ```
2. Dans une autre fenêtre, mets la base à jour : `pnpm --filter @job-radar/db migrate:deploy`
3. Démarre l'appli (serveur + site) :
   ```
   pnpm dev
   ```
4. Ouvre http://localhost:5173 dans ton navigateur et connecte-toi.

Laisse le terminal de `pnpm dev` ouvert : tant qu'il tourne, la collecte des offres se fait toute seule
(toutes les heures), les offres expirées sont nettoyées (toutes les 6 heures) et les alertes partent.

Pour tout arrêter : `Ctrl + C` dans le terminal. La base lancée par le lanceur reste allumée en arrière-plan
(elle consomme très peu) et s'arrête avec le PC.

## 2. Au quotidien

| Je veux…                                   | Commande / action                         |
|--------------------------------------------|-------------------------------------------|
| Lancer une collecte tout de suite          | `pnpm collect`                            |
| Voir la base de données dans un tableau    | `pnpm db:studio`                          |
| Fusionner les doublons déjà en base        | `pnpm jobs:dedupe` (liste), puis `pnpm jobs:dedupe --apply` |
| Voir les offres expirées                   | Tableau de bord → filtre statut « Expirées » |
| Chercher des entreprises (candidature spontanée) | Page « Entreprises »                |
| Garder une offre vue sur LinkedIn, Indeed…  | Page « Ajouter une offre » : colle le titre et le texte |

### Une offre vue sur plusieurs sites

La même offre trouvée sur France Travail, Adzuna et Jooble n'apparaît **qu'une fois**, avec un lien par site.
Elle est reconnue par le lien de l'annonce, ou par l'entreprise + l'intitulé (sans « (H/F) » ni le contrat) + la ville.
Deux villes différentes, ou « CDI » d'un côté et « CDD » de l'autre, restent deux offres.

### Quand une offre est-elle « expirée » ?

- **France Travail** : l'offre n'est plus vue depuis 7 jours **et** l'API confirme qu'elle n'existe plus.
- **Anciennes offres des pages carrières** (fonction retirée) : retirées toutes seules.
- **Adzuna, Jooble** : l'offre a plus de 45 jours.

Si une offre vient de plusieurs sources, elle n'expire que si **toutes** disent qu'elle a disparu.
Les offres que tu as sauvegardées, auxquelles tu as postulé ou que tu as écartées ne sont jamais touchées.

## 3. Mises à jour

**Rien à faire** : à chaque lancement, Job Radar regarde sur GitHub si une nouvelle version a été publiée. Si oui, il la télécharge,
remplace les fichiers du programme, puis redémarre (modules et base de données mis à jour). Ton `.env`, ta base (`data\`) et tes réglages ne sont jamais touchés.
Sans internet, ou si GitHub ne répond pas, Job Radar démarre simplement la version actuelle.
Après une mise à jour du dossier `extension`, recharge l'extension dans le navigateur (flèche « Recharger » sur la page des extensions).

Dossier récupéré avec `git clone` (développeurs) : pas de mise à jour automatique. Fais `git pull`, puis `pnpm install` et `pnpm db:migrate`.

**Publier une nouvelle version (pour le responsable du projet)**
1. Dans `package.json` (à la racine), augmente `"version"` (ex. `1.0.0` → `1.1.0`). Commit et push.
2. Sur GitHub : **Releases** → **Draft a new release** → **Choose a tag** : tape `v1.1.0` (la même version, avec un « v ») → titre, et la liste des nouveautés dans la description (elle s'affiche chez les utilisateurs) → **Publish release**.
3. Chaque utilisateur la reçoit à son prochain lancement. Les brouillons et les « pre-release » ne sont pas distribués.
Le dépôt utilisé est écrit dans `package.json` (`jobRadar.updateRepo`).

## 4. Vérifier que tout marche

| Commande           | Ce qu'elle vérifie                                                    |
|--------------------|-----------------------------------------------------------------------|
| `pnpm check`       | Le code se compile et les tests rapides passent (sans base de données) |
| `pnpm test:int`    | Les tests avec une vraie base (la base doit tourner). Utilise une base à part, `jobradar_test` : tes vraies données ne sont pas touchées |
| `pnpm ft:test`     | Tes identifiants France Travail fonctionnent                          |
| `pnpm sources:test`| Chaque source (France Travail, Adzuna) répond                          |
| `pnpm travel:test` | Le calcul du temps de trajet répond (voiture IGN, + transports PRIM si la clé est là) |
| `pnpm lbb:test`    | La Bonne Boîte (candidatures spontanées) répond                       |
| `pnpm jooble:test` | Ta clé Jooble marche (fait **1 vrai appel**, compté dans les 500)      |
| `pnpm setup:push`  | Génère les clés pour les notifications dans le navigateur (à faire une fois) |
| `pnpm db:demo`     | Ajoute des fausses offres pour tester l'affichage (`pnpm db:demo:clear` pour les retirer) |

## 5. Problèmes courants

**« Can't reach database server » / erreur de connexion à la base**
→ La base n'est pas lancée : relance avec le raccourci, ou `pnpm db:server`. Le détail est dans `data\postgres.log`.

**Une page affiche une erreur après une mise à jour / « companyLead is undefined »**
→ La base ou le client Prisma n'est pas à jour : `pnpm db:migrate`, puis relance `pnpm dev`.

**Le trajet affiche « non calculé »**
→ Vérifie ton adresse de départ dans « Profil ». Le trajet est calculé **en voiture partout en France** (IGN, sans clé)
et **en transports en commun en Île-de-France** si tu as ajouté la clé PRIM (Réglages). La page de l'offre dit « en voiture » ou « en transports ».
Si le lieu de l'offre est inconnu ou loin de toute route, aucune durée n'est inventée : `pnpm travel:test "ton adresse"` pour vérifier.
Le message sous le trajet (page de l'offre) donne la raison.

**Aucune nouvelle offre**
→ Réglages : clique **Tester** sur chaque source. Une source en panne n'empêche pas les autres.

**France Travail refuse les identifiants**
→ Réglages → carte France Travail → **Tester** : le message dit si l'identifiant est faux ou si une API manque à ton application.

**Pas d'e-mail reçu**
→ Réglages → carte Email → **Tester**. Avec Gmail, il faut un « mot de passe d'application », pas ton mot de passe habituel.

**Git dit « index.lock: File exists »**
→ `rm -f .git/index.lock` puis recommence.

**Le port 5173 ou 3000 est déjà utilisé**
→ Un ancien `pnpm dev` tourne encore dans un autre terminal : ferme-le.

## 6. Extension « Envoyer à Job Radar » (Chrome, Edge ou Opera)

Un clic sur une offre (LinkedIn, Indeed, HelloWork, Welcome to the Jungle…) l'ouvre dans Job Radar, déjà remplie.

**Installation (une seule fois)**
1. Dans Job Radar, clique sur **Installer l'extension** (sur la page Offres ou dans le menu). La page détecte Chrome, Edge ou Opera et propose de copier l'adresse de gestion des extensions. Opera GX est détecté comme Opera.
2. Colle l'adresse dans la barre d'adresse du navigateur et appuie sur Entrée. Les navigateurs bloquent l'ouverture de leurs pages internes depuis une page web.
3. Active le **Mode développeur** sur la page des extensions.
4. Clique sur **Charger l'extension non empaquetée**. Dans le sélecteur qui s'ouvre, choisis le dossier `extension` à la racine du dossier où Job Radar a été installé ou extrait (pas le dossier Job Radar complet).
5. Épingle l'icône Job Radar (pièce de puzzle → punaise) pour l'avoir toujours sous la main.

L'installation doit être confirmée par l'utilisateur : une page web ne peut pas installer une extension locale ni sélectionner un dossier sur l'ordinateur. Firefox n'est pas encore compatible avec le script d'arrière-plan Manifest V3 de l'extension. La page d'installation l'indique si Firefox est détecté.
Une fois l'extension chargée, Job Radar la détecte automatiquement sur la page Offres et masque le bouton d'installation. Si tu viens de l'ajouter, recharge la page Job Radar.

**Utilisation**
1. `pnpm dev` doit tourner.
2. Sur la page d'une offre : clique sur l'icône Job Radar (ou **Alt + Maj + J**).
3. Un onglet Job Radar s'ouvre et **l'IA fait tout** (20 à 40 s) : elle lit l'annonce (titre, entreprise, lieu, contrat,
   télétravail, salaire, expérience demandée, compétences), ajoute l'offre (ou complète l'offre Adzuna / Jooble déjà connue),
   l'analyse et vérifie son score. Tu arrives directement sur la page de l'offre.
   Ce que l'IA propose est contrôlé : un salaire, une entreprise ou une expérience absents du texte sont refusés.
   - Tu préfères vérifier avant l'ajout ? Décoche « Ajout automatique depuis l'extension » en haut de « Ajouter une offre ».
   - Ollama éteint : pas d'ajout automatique, le formulaire est rempli par la lecture simple (moins fiable) pour que tu vérifies.
   Les « Voir plus » de la page sont dépliés automatiquement avant l'envoi.

Astuce : si une page est mal lue, sélectionne le texte de l'annonce à la souris avant de cliquer : seule la sélection est envoyée.
L'extension ne lit la page que quand tu cliques, et n'envoie rien ailleurs que vers ton Job Radar.
Après une mise à jour du dossier `extension`, clique sur la flèche « Recharger » de l'extension dans la page de gestion des extensions du navigateur.
Recharge ensuite la page Job Radar : si l'extension est active, elle sera détectée et le bouton d'installation disparaîtra.

## 7. Activer Jooble (plus d'offres)

Jooble regroupe les offres de nombreux sites d'emploi français.

1. Va sur https://fr.jooble.org/api/about et remplis le formulaire (pour « Site web », mets par exemple ta page LinkedIn).
   ⚠️ Prends bien la clé sur **fr**.jooble.org : une clé d'un autre pays ne donne pas les offres françaises.
2. Réglages → carte **Jooble** : colle la clé reçue par email, puis **Enregistrer**.
   (Le bouton **Tester** fait un vrai appel, compté dans les 500.)
3. Page **Sources** → coche **Active** sur Jooble.

**Important :** la clé gratuite donne **500 appels au total** (pas par jour). L'appli économise :
une seule recherche par zone (toutes tes recherches regroupées), une collecte par jour au plus,
et arrêt automatique à 480. Avec 2 zones, ça fait environ 8 mois. Le compteur est visible sur la page Sources.
Quand il est épuisé : demande une nouvelle clé, le compteur repart de zéro tout seul.

## 8. Le fichier `.env`

Il contient tes mots de passe et clés d'API. Il ne doit **jamais** être commité.
Tu n'as pas besoin de l'ouvrir : la page **Réglages** l'écrit pour toi (les autres lignes et les commentaires sont gardés,
et l'ancienne version est copiée dans `.env.bak` avant chaque enregistrement).
Le modèle est `.env.example` : chaque ligne y est expliquée.

## 9. L'IA locale (Ollama) — gratuite, rien ne sort de ton PC

Job Radar utilise **Ollama** avec le modèle **gemma4:e4b**, installés sur ton PC.
Aucune clé, aucun abonnement, et les annonces comme ton profil restent chez toi.

**Première fois**
1. Installe Ollama (https://ollama.com), puis dans PowerShell : `ollama pull gemma4:e4b`
2. Dans les réglages d'Ollama, mets « Context length » sur **8k**.
3. Dans le dossier du projet : `pnpm install`, puis `pnpm ai:test` → tu dois voir une analyse en JSON et sa durée.

**Au quotidien**
- Ollama doit être lancé (icône en bas à droite de Windows). Il démarre tout seul avec Windows par défaut.
- Sur la page d'une offre, carte **Analyse IA** → bouton **Analyser avec l'IA**.
  L'analyse est gardée : la rouvrir ne coûte rien. Elle est signalée « à refaire » si l'annonce ou ton profil change.

**Vérification automatique des scores**
La liste des offres s'affiche par 10. Parmi les offres affichées, celles au-dessus du seuil **« Analyse IA à partir de »** de ton profil (55 % par défaut) sont relues par l'IA
(une à la fois, 5 à 10 s chacune ; « IA en cours… » sur l'offre). Si l'IA juge l'offre peu adaptée, le score baisse :
adéquation **moyenne → 75 % max**, **faible → 50 % max** (l'ancien score reste affiché : « 91 → 50 % »). Elle ne monte jamais un score.
Si ton profil, ton CV ou l'annonce change, l'ancienne vérification ne compte plus et l'offre est revérifiée.
Ollama éteint : la liste marche normalement, avec « IA éteinte : scores non vérifiés ».

**Ce qui est masqué du flux** (case « Offres masquées » pour les revoir)
- Contrat absent de ton profil (score 0) : le contrat est lu dans la source, le titre (« Stage », « Alternance ») ou l'annonce.
- Expérience demandée au-delà de ton maximum + 1 an.
- Offre hors de ta zone : hors de tes départements (et de leurs voisins), ou au-delà du **rayon** choisi dans le Profil.
  Le télétravail complet et les lieux non précisés ne sont jamais masqués. Rubriques en haut de la liste :
  Tout · Dans ma zone · Télétravail complet · Lieu non précisé.
- Salaire non communiqué : note neutre de 50 sur ce critère. Un salaire écrit dans l'annonce (« 2 100 € brut mensuel », « 38-42 k€ ») est lu.

**Notifications** (email et/ou navigateur, carte Notifications de la page Profil)
- Offre au-dessus de ton seuil, annonce complète : « à postuler ».
- Même chose mais Adzuna / Jooble ne donnent qu'un extrait : « à compléter » (score provisoire). Colle l'annonce complète :
  si le score recalculé reste bon, tu reçois alors « à postuler ». Jamais deux fois la même alerte.
- Lettre de motivation terminée : notification du navigateur seulement (pas d'email), et pas si la page est déjà ouverte devant toi.

**Offres Adzuna et Jooble : compléter l'annonce**
Ces sites ne donnent que le début de l'annonce : le score est approximatif (« Extrait · score approximatif » dans la liste)
et l'IA ne vérifie pas ces offres, pour ne pas juger sur un bout de texte.
- Le plus simple : sur la page de l'offre, « Voir l'offre », puis clic sur l'extension **Envoyer à Job Radar** →
  Job Radar reconnaît l'offre et propose **Compléter l'offre existante** (pas de doublon).
- Sinon : **Compléter l'annonce** sur la page de l'offre, puis Ctrl + A, Ctrl + C sur l'annonce et colle.
Le score, l'analyse IA et la lettre utilisent alors l'annonce complète (la collecte ne l'écrase jamais).

**Une info fausse ou manquante sur une offre ?** Page de l'offre → **Modifier les infos** (intitulé, entreprise, ville,
département, contrat, télétravail, salaire, expérience). Tes corrections priment sur la source, la collecte ne les écrase
jamais, et le score est recalculé. « Revenir aux infos de la source » les annule.

**Lettre de motivation**
1. Menu **CV & lettre** : colle ton CV (texte), une lettre que tu as déjà écrite (pour le style), ton en-tête → **Enregistrer**.
2. Page d'une offre, carte **Lettre de motivation** → **Écrire la lettre avec l'IA**. L'IA écrit jusqu'à 3 brouillons, les relit
   et les corrige elle-même, puis garde le meilleur (environ 1 à 2 minutes).
   Facultatif : un modèle plus gros écrit mieux (2 à 3 minutes) → page **Réglages**, carte « Lettre de motivation : modèle d'IA plus gros ».
3. Lis l'encadré **À vérifier avant d'envoyer** (compétence absente de ton CV, nom repris de ta lettre exemple…), corrige
   directement dans le texte, puis **Enregistrer mes modifications**.
4. **Copier** (pour un formulaire ou un email) ou **Enregistrer en PDF** (choisis « Enregistrer au format PDF » comme imprimante).

**Si ça ne marche pas**
- « Ollama ne répond pas » → lance l'appli Ollama, puis réessaie.
- « Modèle pas installé » → `ollama pull gemma4:e4b`
- Autre adresse ou autre modèle → dans `.env` : `OLLAMA_URL=...` et `OLLAMA_MODEL=...`, puis relance `pnpm dev`.

## 10. Lettre en PDF et candidatures spontanées par email

- **PDF de la lettre** : dans « CV & lettre », section 5, colle le dossier où ranger la lettre (ex. `C:\Users\…\Documents\Candidatures`). Le bouton « Enregistrer en PDF » d'une offre écrit alors `Lettre_de_motivation.pdf` dans ce dossier, en remplaçant l'ancien. Si le PDF est ouvert dans un lecteur, ferme-le d'abord.
- **Candidature spontanée** : écran « Entreprises » → colle l'email de contact de l'entreprise → « Préparer la candidature ». L'IA écrit la lettre (sans rien inventer sur l'entreprise), tu la relis, puis « Envoyer » : l'email part de ton Gmail avec la lettre en PDF et ton CV PDF (chemin à indiquer dans « CV & lettre »). Rien ne part sans ton clic, et une entreprise déjà contactée demande une confirmation pour renvoyer.
- L'envoi utilise le même compte que les notifications : carte **Email** de la page Réglages (mot de passe d'application Gmail).
