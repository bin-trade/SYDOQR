/* Passerelle de migration — NE PAS SUPPRIMER avant plusieurs semaines.
   L'ancienne version de cette PWA enregistrait « sw.js » (cache d'abord, jamais mis à jour). Les téléphones qui l'ont installée
   interrogent encore ce fichier : en le faisant charger le nouveau service worker, ils passent seuls à la nouvelle version
   (réseau d'abord, ancien cache « extractor-qr-v1 » supprimé). Les nouvelles installations utilisent service-worker.js. */
importScripts("./service-worker.js");
