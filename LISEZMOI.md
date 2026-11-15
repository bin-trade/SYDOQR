# PWA de vérification QR EXTRACTOR

Cette application est une PWA mobile-first destinée à vérifier les rapports imprimés.

## Déploiement

1. Servir le contenu de ce dossier en HTTPS ou le publier sur un hébergement statique.
2. Vérifier l’URL `reportsApiUrl` dans `config.js`.
3. Ouvrir l’URL sur téléphone puis choisir l’installation de l’application.
4. Pour une mise à jour, remplacer les fichiers puis incrémenter `CACHE_NAME` dans `sw.js`.

La PWA ne lit jamais directement Google Sheets. Elle appelle l’action `verifyReport` de l’Apps Script du registre `RAPPORTS_DGDA`.
