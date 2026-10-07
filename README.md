# Job Radar

Ton assistant personnel de recherche d'emploi, **installé sur ton PC**, pour **n'importe quel métier**.

Tu déposes ton CV une fois. Job Radar va ensuite chercher les offres sur plusieurs sites, te dit lesquelles te correspondent
(avec une note sur 100 et pourquoi), et t'aide à postuler : lettre de motivation, candidatures spontanées, suivi.

Exemple : Camille, aide-soignante à Nantes, reçoit chaque jour les nouvelles offres d'aide-soignant autour de chez elle,
triées de la plus adaptée à la moins adaptée, avec le temps de trajet, et une lettre prête à relire en un clic.

Tout reste chez toi : la base de données et l'intelligence artificielle (Ollama) tournent sur ton ordinateur. Aucun compte en ligne,
aucun abonnement.

## Ce que fait Job Radar

- **Collecte les offres** toute seule : France Travail (et ses partenaires), Adzuna, Jooble.
- **Ajoute une offre vue ailleurs** (LinkedIn, Indeed, HelloWork…) en un clic avec l'extension du navigateur.
- **Note chaque offre** par rapport à ton profil (compétences, expérience, contrat, salaire, lieu, temps de trajet) et explique la note.
- **Fait relire les meilleures offres par l'IA** de ton PC, qui lit l'annonce complète et signale les pièges.
- **Écrit ta lettre de motivation** à partir de ton CV, dans ton style, et l'enregistre en PDF.
- **Candidatures spontanées** : entreprises qui recrutent près de chez toi (La Bonne Boîte), lettre adaptée, envoi par email après ta relecture.
- **Suit tes candidatures** (en attente, refus, relances).

## Ce qu'il faut

- Un PC **Windows 10 ou 11**, avec 8 Go de mémoire au minimum (16 Go conseillés). Une carte graphique rend l'IA plus rapide.
- Environ 8 Go d'espace libre sur le disque.
- Une connexion internet.
- Une adresse email (pour ton compte local et, si tu veux, recevoir les alertes).

## Installation (une seule fois, 15 à 30 minutes)

1. Sur la page GitHub du projet, clique sur le bouton vert **Code**, puis **Download ZIP**.
2. Dans ton dossier Téléchargements : clic droit sur le fichier `.zip` → **Extraire tout**, et choisis par exemple `Documents`.
3. Ouvre le dossier extrait et double-clique sur **« Installer Job Radar.cmd »**. Suis ce qui s'affiche : il installe tout ce qui manque
   (Node.js, Ollama, le modèle d'IA, la base de données) et crée le raccourci **« Job Radar »** sur le Bureau.
   Si l'installation s'arrête, corrige le point indiqué et relance-la : ce qui est déjà fait est gardé.

## Premier lancement

1. Double-clique sur le raccourci **« Job Radar »** du Bureau. Le site s'ouvre dans ton navigateur.
2. **Crée ton compte** (email + mot de passe de 12 caractères minimum). Il protège seulement ton espace sur ce PC.
3. **Dépose ton CV** (PDF, Word ou texte). L'IA de ton PC le lit (30 secondes à 2 minutes) et propose ton profil :
   métiers à rechercher, compétences, ville, expérience, contrats, et codes métier pour les candidatures spontanées.
4. **Relis et corrige**, puis clique sur « C'est bon, lancer la recherche ».
5. Va dans **Réglages** pour ajouter au moins une source d'offres (voir ci-dessous).

## Réglages : les clés gratuites

Les sites d'offres demandent une « clé » gratuite pour être interrogés. Menu **Réglages** : chaque carte explique à quoi sert le service,
où créer la clé et quoi cocher. Colle la clé, clique **Enregistrer** (pris en compte tout de suite), puis **Tester**.

| Service | À quoi ça sert | Indispensable ? |
|---|---|---|
| France Travail | Offres France Travail et partenaires, page « Entreprises », codes métier | Conseillé |
| Adzuna | Offres de nombreux sites d'emploi | Facultatif |
| Jooble | Encore plus d'offres (500 appels au total par clé) | Facultatif |
| Email (Gmail) | Alertes de nouvelles offres, envoi des candidatures spontanées | Facultatif |
| Transports en Île-de-France (PRIM) | Durée en transports en commun en Île-de-France (sans clé : en voiture, partout en France) | Facultatif |

Il faut **au moins une source d'offres** (France Travail, Adzuna ou Jooble) pour recevoir des offres.

## Au quotidien

- Lance Job Radar avec le raccourci du Bureau. Tant qu'il est ouvert, les offres sont collectées toutes seules.
- **Mises à jour automatiques** : à chaque lancement, la dernière version publiée est installée toute seule (tes données sont gardées).
- Page **Offres** : les offres triées par note. Ouvre une offre pour voir le détail, l'avis de l'IA et écrire la lettre.
- Page **Entreprises** : les entreprises qui recrutent près de chez toi, pour une candidature spontanée.
- Tout reste modifiable dans **Profil** et **CV & lettre**.

Mode d'emploi complet et problèmes courants : [docs/LANCEMENT.md](docs/LANCEMENT.md).

## Données et vie privée

- Ton CV, ton profil, tes lettres et tes candidatures sont stockés **uniquement** dans la base de données de ton PC.
- L'IA (Ollama) fonctionne **sans internet** : rien n'est envoyé à une IA en ligne.
- Les sites d'offres sont interrogés par leurs **API officielles**. Les sites qui interdisent la collecte automatique ne sont pas
  collectés : pour eux, l'extension te permet d'ajouter une offre que tu consultes toi-même.
- Temps de trajet en voiture : calcul d'itinéraire de la Géoplateforme, © IGN — Géoplateforme (Licence Ouverte).
  En Île-de-France, avec la clé PRIM : Île-de-France Mobilités.
- Liste des métiers : Répertoire Opérationnel des Métiers et des Emplois (ROME 4.0) de France Travail, sous Licence Ouverte (Etalab).
  Pour la mettre à jour : voir `packages/shared/scripts/build-rome.mjs`.

## Avancement

1. ✅ Copie propre du projet d'origine (aucune donnée personnelle).
2. ✅ Installeur Windows (Node, Ollama, modèle d'IA, base de données intégrée sans Docker, raccourci).
3. ✅ Premier lancement guidé : création du compte, dépôt du CV, profil construit par l'IA puis validé par toi.
4. ✅ Moteur généraliste : compétences tirées du CV, sans filtre ni pénalité réservés aux métiers de l'informatique.
5. ✅ Page « Réglages » : clés France Travail, Adzuna, Jooble, Gmail et trajets directement dans le site, avec un bouton Tester, sans redémarrer.
6. ✅ Codes métier (ROME) proposés au premier lancement (France Travail ROMEO, ou IA locale contrôlée par la liste officielle) : la page « Entreprises » marche dès le départ.
7. ✅ Nettoyage avant publication : textes et exemples neutres pour tous les métiers, offres de démo variées.
8. ✅ Temps de trajet partout en France : en voiture (IGN, sans clé), en transports en commun en Île-de-France (PRIM).
9. ✅ Mises à jour automatiques au lancement (dernière « Release » GitHub), sans git ni téléchargement à la main.
10. ✅ Score plus juste : contrat hors profil à 0 (lu aussi dans le titre et l'annonce), salaire lu dans l'annonce, rayon de recherche et rubriques de zone, seuils du profil respectés.
11. ✅ Dédoublonnage : une offre vue sur plusieurs sites = une seule offre avec tous ses liens (`pnpm jobs:dedupe` pour l'existant).
12. ✅ Navigation : retour à la même position dans les listes, lieux cliquables (Google Maps), annonce sans description signalée « à compléter ».
13. ✅ Notifications « à compléter » puis « à postuler », et « lettre terminée » dans le navigateur.
14. ✅ Lettre de motivation : plusieurs brouillons relus et corrigés, modèle plus gros au choix (Réglages).
15. ✅ Entreprises : recherche par nom, filtre « avec email saisi », prompt des emails plus fiable, résultat d'envoi près du bouton.
16. ✅ « Modifier les infos » d'une offre : tes corrections priment sur la source et recalculent le score.
17. ✅ Lancement en arrière-plan, bouton « Arrêter Job Radar », relance d'une source depuis Réglages.
18. ✅ Page Candidatures : onglets « Sur une offre » et « Spontanées », date de candidature.
19. ⏳ Tests complets avec des profils variés.

## Pour les développeurs

Monorepo pnpm (API Fastify, site Vue 3, PostgreSQL intégré, Prisma). Dans le dossier du projet :

- `pnpm dev` : lance l'API et le site (http://localhost:5173).
- `pnpm check` : vérifie les types et lance les tests.
- `pnpm jobs:dedupe` : fusionne les doublons déjà en base (`--apply` pour appliquer).
- `pnpm db:demo` : ajoute des offres de démonstration (`pnpm db:demo:clear` pour les retirer).
