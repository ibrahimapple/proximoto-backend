# ProxiMoto — Backend

## Démarrage
```
npm install
node src/server.js
```
Le serveur écoute sur le port 3000 (variable d'env PORT pour changer).

## Endpoints

### Chauffeur (appelé en continu par l'appli chauffeur, ex. toutes les 5-10s)
POST /drivers/:id/location
body: { name, lat, lng, online }

POST /drivers/:id/subscription
body: { active: true|false }  -> statut de l'abonnement 100 F/mois

GET /drivers  -> liste des chauffeurs connus

### Client
POST /rides/request
body: { lat, lng }
-> cherche le chauffeur en ligne + abonné le plus proche, retourne { ride, driver, distanceKm }

POST /rides/:id/dispute
-> exclut le chauffeur actuel, relaye vers le suivant le plus proche

GET /rides/:id  -> état d'une course

## Temps réel (Socket.io)
Le chauffeur se connecte et émet `driver:join` avec son id pour rejoindre sa room.
Il reçoit l'évènement `ride:assigned` dès qu'une course lui est attribuée.
Le canal `drivers:update` diffuse la liste des chauffeurs à chaque mise à jour de position (utile pour un futur dashboard admin).

## Prochaine étape (production)
Remplacer le stockage en mémoire (Map) par Postgres + PostGIS pour la recherche
géospatiale à l'échelle, et ajouter l'authentification des chauffeurs/clients.
