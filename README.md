# Job Radar

Ton assistant personnel de recherche d'emploi, **sur ton PC** : il récupère les offres de plusieurs sites, les compare à ton CV, te
dit lesquelles valent le coup, et t'aide à postuler (lettre de motivation, candidatures spontanées).

Tout reste chez toi : la base de données (intégrée, sans Docker ni compte) et l'intelligence artificielle (Ollama) tournent sur ton ordinateur.

> 🚧 **Version en construction.** Cette version publique est adaptée à tous les métiers étape par étape (voir « Avancement » ci-dessous).

## Ce que fait Job Radar

- **Collecte les offres** automatiquement : France Travail (et ses partenaires), Adzuna, Jooble, pages carrières d'entreprises.
- **Ajoute une offre vue ailleurs** (LinkedIn, Indeed, Welcome to the Jungle…) en un clic avec l'extension du navigateur.
- **Note chaque offre** par rapport à ton profil (compétences, expérience, contrat, salaire, lieu, temps de trajet) et explique la note.
- **Fait vérifier les meilleures offres par l'IA locale**, qui lit l'annonce complète.
- **Écrit ta lettre de motivation** à partir de ton CV, dans ton style, et l'enregistre en PDF.
- **Candidatures spontanées** : entreprises qui recrutent près de chez toi (La Bonne Boîte), lettre adaptée, envoi par email après relecture.
- **Suit tes candidatures** (en attente, refus, relances).

## Ce qu'il faut

- Un PC **Windows 10 ou 11**, 8 Go de mémoire minimum (16 Go conseillés), une carte graphique conseillée pour que l'IA soit rapide.
- Environ 8 Go d'espace disque (IA, base de données).
- Une connexion internet.

## Installation

1. Télécharge le projet et décompresse-le (par exemple dans `Documents\jobRadar`).
2. Double-clic sur **« Installer Job Radar.cmd »** et suis les étapes (15 à 30 minutes la première fois).
3. Ensuite, lance Job Radar avec le raccourci **« Job Radar »** du Bureau.
4. Au premier lancement, le site te fait créer ton compte puis déposer ton CV : l'IA de ton PC le lit et prépare ton profil, que tu relis.
5. Menu **Réglages** : ajoute les clés gratuites des sites d'offres (France Travail, Adzuna, Jooble), de ton email et du temps de trajet.
   Chaque carte explique comment obtenir la clé, avec un bouton **Tester**.

Détails et problèmes courants : [docs/LANCEMENT.md](docs/LANCEMENT.md).

## Avancement

1. ✅ Copie propre du projet d'origine (aucune donnée personnelle).
2. ✅ Installeur Windows (Node, Ollama, modèle d'IA, base de données intégrée sans Docker, raccourci).
3. ✅ Premier lancement guidé : création du compte, dépôt du CV, profil construit par l'IA puis validé par toi.
4. ✅ Moteur généraliste : compétences tirées du CV, sans filtre ni pénalité réservés aux métiers de l'informatique.
5. ✅ Page « Réglages » : clés France Travail, Adzuna, Jooble, Gmail et trajets directement dans le site, avec un bouton Tester, sans redémarrer.
6. ✅ Codes métier (ROME) proposés au premier lancement (France Travail ROMEO, ou IA locale contrôlée par la liste officielle) : la page « Entreprises » marche dès le départ.
7. ⏳ Temps de trajet partout en France.
8. ⏳ Mode d'emploi et tests avec des profils variés.

## Données et vie privée

- Ton CV, ton profil, tes lettres et tes candidatures sont stockés **uniquement** dans la base de données de ton PC.
- L'IA (Ollama) fonctionne **sans internet** : rien n'est envoyé à une IA en ligne.
- Liste des métiers : Répertoire Opérationnel des Métiers et des Emplois (ROME 4.0) de France Travail, sous Licence Ouverte (Etalab).
  Pour la mettre à jour : voir `packages/shared/scripts/build-rome.mjs`.
- Les sites d'offres sont interrogés par leurs **API officielles**. Les sites qui interdisent la collecte automatique ne sont pas
  collectés : pour eux, l'extension te permet d'ajouter une offre que tu consultes toi-même.
