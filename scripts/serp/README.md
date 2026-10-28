# Recherche Google en JSON (positionnement)

Récupère les résultats organiques de Google (position, titre, URL, extrait, domaine) avec un Chrome local **visible**
et un profil persistant ([patchright](https://www.npmjs.com/package/patchright)). Utilisé par l'onglet « Positionnement ».

## Prérequis
- Google Chrome installé (`channel: "chrome"`, aucun téléchargement de Chromium).
- `npm install` (installe `patchright`).

## Utilisation
```bash
npm run serp -- "résidences seniors toulouse" --pages 1 --profile ./.serp-profile --out results.json
npm run test:serp        # tests du parseur sur du HTML simulé
```
Options : `--pages` (1 à 3, 10 résultats par page, pause de 3 à 8 s entre pages), `--profile`, `--timeout` (secondes, 180),
`--out` (sinon JSON sur la sortie standard), `--debug-dir` (défaut `debug/`).

Codes de sortie : `0` succès ; `2` captcha ou blocage ; `1` autre erreur.

## Règles d'usage
- Les recherches automatisées vont à l'encontre des conditions d'utilisation de Google : quelques requêtes espacées seulement.
- Aucun contournement de captcha : en cas de captcha, le résoudre à la main dans la fenêtre. En cas d'échec, une capture
  et le HTML de la page sont enregistrés dans `debug/` pour ajuster les sélecteurs de `parse.mjs`.
- Profil Chrome dédié : ne jamais le connecter à un compte Google personnel.
- Dans l'application, les résultats sont mis en cache 24 h (`.cache/serp/`).
