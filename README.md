# Job Radar

Ton assistant personnel de recherche d'emploi, **sur ton PC** : il récupère les offres de plusieurs sites, les compare à ton CV, te
dit lesquelles valent le coup, et t'aide à postuler (lettre de motivation, candidatures spontanées).

Tout reste chez toi : la base de données et l'intelligence artificielle (Ollama) tournent sur ton ordinateur.

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
- Environ 10 Go d'espace disque (Docker, IA, base de données).
- Une connexion internet.

## Installation

1. Télécharge le projet et décompresse-le (par exemple dans `Documents\jobRadar`).
2. Double-clic sur **« Installer Job Radar.cmd »** et suis les étapes (15 à 30 minutes la première fois).
3. Ensuite, lance Job Radar avec le raccourci **« Job Radar »** du Bureau.

Détails et problèmes courants : [docs/LANCEMENT.md](docs/LANCEMENT.md).

## Avancement

1. ✅ Copie propre du projet d'origine (aucune donnée personnelle).
2. ✅ Installeur Windows (Node, Docker Desktop, Ollama, modèle d'IA, base de données, raccourci).
3. ⏳ Premier lancement guidé : création du compte, dépôt du CV, profil construit par l'IA puis validé par toi.
4. ⏳ Moteur pour tous les métiers (compétences tirées de ton CV, plus seulement l'informatique).
5. ⏳ Assistant des clés (France Travail, Adzuna, Jooble, trajets, Gmail) directement dans le site.
6. ⏳ Mode d'emploi et tests avec des profils variés.

## Données et vie privée

- Ton CV, ton profil, tes lettres et tes candidatures sont stockés **uniquement** dans la base de données de ton PC.
- L'IA (Ollama) fonctionne **sans internet** : rien n'est envoyé à une IA en ligne.
- Les sites d'offres sont interrogés par leurs **API officielles**. Les sites qui interdisent la collecte automatique ne sont pas
  collectés : pour eux, l'extension te permet d'ajouter une offre que tu consultes toi-même.
