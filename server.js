const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- Stockage en mémoire (à remplacer par Postgres/PostGIS en production) ---
const drivers = new Map();   // id -> { id, name, lat, lng, online, subscriptionActive, lastSeen }
const rides = new Map();     // id -> { id, clientLat, clientLng, driverId, status, excludedDriverIds }

let rideCounter = 1;

// --- Utilitaires ---
function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function findNearestDriver(clientPos, excludedIds = []) {
  let best = null;
  let bestDist = Infinity;
  for (const d of drivers.values()) {
    if (!d.online || !d.subscriptionActive) continue;
    if (excludedIds.includes(d.id)) continue;
    const dist = haversineKm(clientPos, { lat: d.lat, lng: d.lng });
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best ? { driver: best, distanceKm: bestDist } : null;
}

// --- Chauffeurs ---

// Enregistrement / mise à jour de position + statut (appelé en continu par l'appli chauffeur)
app.post('/drivers/:id/location', (req, res) => {
  const { id } = req.params;
  const { name, lat, lng, online } = req.body;
  const existing = drivers.get(id) || { subscriptionActive: true };
  const driver = {
    id,
    name: name || existing.name || 'Chauffeur',
    lat, lng,
    online: !!online,
    subscriptionActive: existing.subscriptionActive,
    lastSeen: Date.now()
  };
  drivers.set(id, driver);
  io.emit('drivers:update', Array.from(drivers.values()));
  res.json({ ok: true, driver });
});

// Statut d'abonnement (100 F/mois — gratuit en phase pilote)
app.post('/drivers/:id/subscription', (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  const driver = drivers.get(id);
  if (!driver) return res.status(404).json({ ok: false, error: 'Chauffeur inconnu' });
  driver.subscriptionActive = !!active;
  drivers.set(id, driver);
  res.json({ ok: true, driver });
});

app.get('/drivers', (req, res) => {
  res.json(Array.from(drivers.values()));
});

// --- Courses ---

// Le client demande une course : on cherche le chauffeur en ligne le plus proche
app.post('/rides/request', (req, res) => {
  const { lat, lng } = req.body;
  const clientPos = { lat, lng };
  const match = findNearestDriver(clientPos);
  const rideId = String(rideCounter++);

  const ride = {
    id: rideId,
    clientLat: lat,
    clientLng: lng,
    driverId: match ? match.driver.id : null,
    status: match ? 'matched' : 'no_driver_available',
    excludedDriverIds: []
  };
  rides.set(rideId, ride);

  if (match) {
    io.to(`driver:${match.driver.id}`).emit('ride:assigned', ride);
  }

  res.json({
    ok: !!match,
    ride,
    driver: match ? match.driver : null,
    distanceKm: match ? Number(match.distanceKm.toFixed(2)) : null
  });
});

// Désaccord de prix : on exclut le chauffeur actuel et on relaye vers le suivant
app.post('/rides/:id/dispute', (req, res) => {
  const ride = rides.get(req.params.id);
  if (!ride) return res.status(404).json({ ok: false, error: 'Course inconnue' });

  if (ride.driverId) ride.excludedDriverIds.push(ride.driverId);

  const clientPos = { lat: ride.clientLat, lng: ride.clientLng };
  const match = findNearestDriver(clientPos, ride.excludedDriverIds);

  ride.driverId = match ? match.driver.id : null;
  ride.status = match ? 'matched' : 'no_driver_available';
  rides.set(ride.id, ride);

  if (match) {
    io.to(`driver:${match.driver.id}`).emit('ride:assigned', ride);
  }

  res.json({
    ok: !!match,
    ride,
    driver: match ? match.driver : null,
    distanceKm: match ? Number(match.distanceKm.toFixed(2)) : null
  });
});

app.get('/rides/:id', (req, res) => {
  const ride = rides.get(req.params.id);
  if (!ride) return res.status(404).json({ ok: false, error: 'Course inconnue' });
  res.json(ride);
});

// --- Temps réel : un chauffeur rejoint sa room personnelle pour recevoir ses demandes ---
io.on('connection', (socket) => {
  socket.on('driver:join', (driverId) => {
    socket.join(`driver:${driverId}`);
  });
});

// Nettoyage : marque hors ligne les chauffeurs inactifs depuis plus de 30s
setInterval(() => {
  const now = Date.now();
  for (const d of drivers.values()) {
    if (d.online && now - d.lastSeen > 30000) {
      d.online = false;
    }
  }
}, 10000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ProxiMoto backend en écoute sur le port ${PORT}`);
});
