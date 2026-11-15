# PWA Vérification QR — SYDONIA

Vérification mobile des rapports imprimés exclusivement par scan du code QR. Dossier **autonome**.
Identité SYDONIA (bleu/or, motif de scan QR) : le logo DGDA n'est pas utilisé ici.

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | Interface et logique |
| `config.js` | URL `/exec` du registre (action publique `syncReports`), aucun secret |
| `vendor/jsQR.js` (+ licence) | Lecteur QR de secours (Apache-2.0) pour les navigateurs sans `BarcodeDetector` : Firefox, Safari, anciens Android |
| `fonts/`, `assets/` | Police locale, icônes 192/512, maskable, apple-touch, favicons, logos 64/128 |
| `manifest.webmanifest`, `service-worker.js` | Installation PWA, hors-ligne de l'interface, mise à jour automatique |
| `sw.js` | Passerelle de migration : fait passer les anciennes installations (qui enregistraient `sw.js`) au nouveau service worker. À supprimer dans quelques semaines. |

## Caméra
La caméra exige **HTTPS** (GitHub Pages convient) ou `localhost`. Au premier lancement,
ou après le bouton « Actualiser les données », la PWA récupère le registre DGDA et le
conserve dans `localStorage`. Les scans suivants sont vérifiés localement et ne
déclenchent pas de requête Apps Script.

## Essai local
```
cd PWA/VERIFICATION_QR
python -m http.server 8080      # puis http://localhost:8080
```

## Mise à jour
Réseau d'abord + rechargement automatique unique. Pour forcer : changer `VERSION` dans `service-worker.js` et `?v=` dans `index.html`.
