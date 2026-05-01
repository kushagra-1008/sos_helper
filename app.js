// ── Emergency Data (loaded once) ─────────────────────────────────────────────

let ALL_FACILITIES = [];
let DATA_LOADED = false;

/**
 * Load the local facilities.json once at startup.
 * The compact format uses short keys: n=name, c=category, a=lat, o=lon
 * This makes the app work entirely offline after the initial page load.
 */
async function loadEmergencyData() {
  try {
    const res = await fetch("./facilities.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();

    // Expand compact keys → full keys for internal use
    ALL_FACILITIES = raw.map(f => ({
      name: f.n,
      category: f.c,
      lat: f.a,
      lon: f.o,
    }));

    DATA_LOADED = true;
    console.log(`📦 Loaded ${ALL_FACILITIES.length} facilities from local JSON`);
    updateLoadingStatus();
  } catch (err) {
    console.error("Failed to load facility data:", err);
    document.getElementById("status").textContent =
      "⚠️ Could not load facility data. Make sure facilities.json is present.";
    document.getElementById("status").style.color = "#ff6b6b";
  }
}

function updateLoadingStatus() {
  const indicator = document.getElementById("data-status");
  if (!indicator) return;
  if (DATA_LOADED) {
    indicator.textContent = `✅ ${ALL_FACILITIES.length.toLocaleString()} facilities loaded`;
    indicator.className = "data-status loaded";
  }
}

// Kick off the data load immediately
const dataReady = loadEmergencyData();

// ── Register Service Worker for true offline support ─────────────────────────

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then(reg => console.log("🔧 Service Worker registered:", reg.scope))
    .catch(err => console.warn("Service Worker registration failed:", err));
}

// ── Distance helpers ──────────────────────────────────────────────────────────

/**
 * Haversine distance between two GPS points.
 * @returns distance in metres
 */
function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Human-readable distance string (e.g. "350 m" or "2.4 km"). */
function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Bearing from user to facility.
 * @returns {string} e.g. "NW ↖️"
 */
function getBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  let brng = toDeg(Math.atan2(y, x));
  brng = (brng + 360) % 360;
  
  const directions = ["N ⬆️", "NE ↗️", "E ➡️", "SE ↘️", "S ⬇️", "SW ↙️", "W ⬅️", "NW ↖️"];
  const index = Math.round(brng / 45) % 8;
  return directions[index];
}

// ── Nearest facility finder ──────────────────────────────────────────────────

/**
 * Find the nearest N facilities of a given category using Haversine.
 *
 * Optimization: uses a bounding-box pre-filter. For ~120k facilities this
 * skips the expensive trig for anything outside ~50 km, making the search
 * near-instant even on low-end devices.
 *
 * @param {number}  userLat
 * @param {number}  userLon
 * @param {string}  category — "hospital", "police", or "fire_station"
 * @param {number}  [limit=50]  — fetch more for "show more" pagination
 * @returns {Array<{name, lat, lon, distMetres, dist}>}
 */
function findNearest(userLat, userLon, category, limit = 50) {
  // ~1° ≈ 110 km bounding box pre-filter (wider for more results)
  const BOX = 1.0;
  const latMin = userLat - BOX, latMax = userLat + BOX;
  const lonMin = userLon - BOX, lonMax = userLon + BOX;

  const candidates = [];
  for (let i = 0; i < ALL_FACILITIES.length; i++) {
    const f = ALL_FACILITIES[i];
    if (f.category !== category) continue;
    if (f.lat == null || f.lon == null) continue;
    // Quick bounding-box reject
    if (f.lat < latMin || f.lat > latMax || f.lon < lonMin || f.lon > lonMax) continue;
    const distMetres = haversineMetres(userLat, userLon, f.lat, f.lon);
    const bearing = getBearing(userLat, userLon, f.lat, f.lon);
    candidates.push({
      name: f.name,
      lat: f.lat,
      lon: f.lon,
      distMetres,
      dist: formatDistance(distMetres),
      bearing: bearing,
    });
  }

  // If bounding box returned too few, widen to full dataset
  if (candidates.length < limit) {
    candidates.length = 0;
    for (let i = 0; i < ALL_FACILITIES.length; i++) {
      const f = ALL_FACILITIES[i];
      if (f.category !== category || f.lat == null || f.lon == null) continue;
      const distMetres = haversineMetres(userLat, userLon, f.lat, f.lon);
      const bearing = getBearing(userLat, userLon, f.lat, f.lon);
      candidates.push({
        name: f.name,
        lat: f.lat,
        lon: f.lon,
        distMetres,
        dist: formatDistance(distMetres),
        bearing: bearing,
      });
    }
  }

  candidates.sort((a, b) => a.distMetres - b.distMetres);
  return candidates.slice(0, limit);
}

// ── Geolocation ───────────────────────────────────────────────────────────────

/**
 * getUserLocation()
 * Uses watchPosition to collect fixes for up to WATCH_MS milliseconds,
 * then picks the one with the best (lowest) accuracy value.
 *
 * @returns {Promise<{ lat: number, lon: number, accuracy: number }>}
 */
function getUserLocation(WATCH_MS = 6000, GOOD_ACCURACY_M = 50) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject("Geolocation is not supported by your browser.");
      return;
    }

    const fixes = [];
    let watchId;
    let settled = false;

    function finish() {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(watchId);

      if (!fixes.length) {
        reject("No location fix received. Try again.");
        return;
      }

      fixes.sort((a, b) => a.accuracy - b.accuracy);
      const best = fixes[0];
      console.log(`📍 Best fix — lat: ${best.lat}, lon: ${best.lon}, accuracy: ±${Math.round(best.accuracy)}m`);
      resolve(best);
    }

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = {
          lat:      pos.coords.latitude,
          lon:      pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        fixes.push(fix);
        console.log(`📡 Fix received — accuracy: ±${Math.round(fix.accuracy)}m`);
        if (fix.accuracy <= GOOD_ACCURACY_M) finish();
      },
      (error) => {
        const messages = {
          1: "Location permission denied. Please allow access and try again.",
          2: "Location unavailable. Check your device's GPS or network.",
          3: "Location request timed out. Please try again.",
        };
        if (!fixes.length) reject(messages[error.code] || "Unknown location error.");
        else finish();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    setTimeout(finish, WATCH_MS);
  });
}

// ── Static emergency numbers ─────────────────────────────────────────────────

const EMERGENCY_NUMBERS = [
  { name: "National Emergency Number",     dist: "All India", phone: "tel:112" },
  { name: "Ambulance (108)",               dist: "On-call",   phone: "tel:108" },
  { name: "Women Helpline (1091)",          dist: "On-call",   phone: "tel:1091" },
  { name: "Disaster Management (1078)",     dist: "On-call",   phone: "tel:1078" },
];

// ── Leaflet Map ──────────────────────────────────────────────────────────────

let map = null;
let markersGroup = null;

/** Category → marker colour */
const MARKER_COLORS = {
  hospital:     "#4da6ff",
  police:       "#ffca3a",
  fire_station: "#ff8c42",
  user:         "#ff4d5a",
};

/**
 * Create a coloured circle marker icon for Leaflet.
 */
function colorIcon(color, size = 12) {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width:${size}px; height:${size}px;
      background:${color};
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 8px ${color}88;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/**
 * Initialise or update the Leaflet map with user location and nearby facilities.
 */
function initMap(userLat, userLon, allResults) {
  const mapContainer = document.getElementById("map-container");
  mapContainer.style.display = "block";

  if (!map) {
    map = L.map("map", {
      zoomControl: true,
      attributionControl: false,
    }).setView([userLat, userLon], 14);

    // OpenStreetMap tiles — cached by Service Worker for offline
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);

    // Dark overlay attribution in corner
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    markersGroup = L.layerGroup().addTo(map);
  } else {
    map.setView([userLat, userLon], 14);
    markersGroup.clearLayers();
  }

  // User marker (pulsing red)
  const userIcon = L.divIcon({
    className: "custom-marker",
    html: `<div class="user-marker-dot"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  L.marker([userLat, userLon], { icon: userIcon })
    .bindPopup("<strong>📍 You are here</strong>")
    .addTo(markersGroup);

  // Add facility markers (only those currently visible — first 5 of each)
  const bounds = L.latLngBounds([[userLat, userLon]]);

  allResults.forEach(({ items, category }) => {
    // Show first 5 on map initially
    items.slice(0, 5).forEach(item => {
      if (item.lat == null || item.lon == null) return;
      const color = MARKER_COLORS[category] || "#aaa";
      L.marker([item.lat, item.lon], { icon: colorIcon(color) })
        .bindPopup(`<strong>${item.name}</strong><br>${item.dist}`)
        .addTo(markersGroup);
      bounds.extend([item.lat, item.lon]);
    });
  });

  map.fitBounds(bounds.pad(0.15));

  // Force Leaflet to recalculate after container becomes visible
  setTimeout(() => map.invalidateSize(), 200);
  document.getElementById("download-map-ui").style.display = "flex";
}

/**
 * Add more markers to map when "Show more" is clicked.
 */
function addMarkersToMap(items, category) {
  if (!map || !markersGroup) return;
  const color = MARKER_COLORS[category] || "#aaa";
  items.forEach(item => {
    if (item.lat == null || item.lon == null) return;
    L.marker([item.lat, item.lon], { icon: colorIcon(color) })
      .bindPopup(`<strong>${item.name}</strong><br>${item.dist}`)
      .addTo(markersGroup);
  });
}

// ── "Show More" Pagination ───────────────────────────────────────────────────

const PAGE_SIZE = 5;

/** State: full result sets and current visible count per category */
const sectionState = {
  hospitals: { allItems: [], shown: 0, listId: "hospitals-list", btnId: "hospitals-more", category: "hospital" },
  police:    { allItems: [], shown: 0, listId: "police-list",    btnId: "police-more",    category: "police" },
  fire:      { allItems: [], shown: 0, listId: "fire-list",      btnId: "fire-more",      category: "fire_station" },
};

/**
 * Build a single card DOM element.
 */
function createCard(item, index, userLat, userLon) {
  const card = document.createElement("div");
  card.className = "card";
  card.style.animationDelay = `${index * 0.06}s`;

  const hasCoords = item.lat != null && item.lon != null && userLat != null;
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1`
      + `&origin=${userLat},${userLon}`
      + `&destination=${item.lat},${item.lon}`
      + `&travelmode=driving`
    : null;

  card.innerHTML = `
    <div class="card-info">
      <div class="name">${item.name}</div>
      <div class="dist">📍 ${item.dist ?? "Nearby"} ${item.bearing ? ` • 🧭 ${item.bearing}` : ""}</div>
    </div>
    <div class="card-actions">
      ${mapsUrl
        ? `<a class="card-nav" href="${mapsUrl}" target="_blank" rel="noopener">🧭 Navigate</a>`
        : ""}
      ${item.phone
        ? `<a class="card-call" href="${item.phone}">📞 Call</a>`
        : ""}
    </div>
  `;
  return card;
}

/**
 * Render initial cards and set up "Show more" button for a section.
 */
function initSection(sectionKey, items, userLat, userLon) {
  const state = sectionState[sectionKey];
  if (!state) return;

  state.allItems = items;
  state.shown = 0;
  state.userLat = userLat;
  state.userLon = userLon;

  const container = document.getElementById(state.listId);
  container.innerHTML = "";

  if (!items.length) {
    const card = createCard({ name: `No ${sectionKey} found nearby`, dist: "—" }, 0);
    container.appendChild(card);
    document.getElementById(state.btnId).style.display = "none";
    return;
  }

  // Show first PAGE_SIZE
  showMore(sectionKey);
}

/**
 * Show the next PAGE_SIZE cards in a section.
 */
function showMore(sectionKey) {
  const state = sectionState[sectionKey];
  const container = document.getElementById(state.listId);
  const btn = document.getElementById(state.btnId);

  const start = state.shown;
  const end = Math.min(start + PAGE_SIZE, state.allItems.length);
  const newItems = state.allItems.slice(start, end);

  newItems.forEach((item, i) => {
    const card = createCard(item, i, state.userLat, state.userLon);
    container.appendChild(card);
  });

  // Add new markers to map
  if (start > 0) {
    addMarkersToMap(newItems, state.category);
  }

  state.shown = end;

  // Update button
  const remaining = state.allItems.length - state.shown;
  if (remaining > 0) {
    btn.style.display = "block";
    btn.textContent = `Show more +${Math.min(PAGE_SIZE, remaining)}  (${remaining} remaining)`;
  } else {
    btn.style.display = "none";
  }
}

/**
 * Render emergency numbers (no pagination needed).
 */
function buildEmergencyCards(listId, items) {
  const container = document.getElementById(listId);
  container.innerHTML = "";
  items.forEach((item, index) => {
    container.appendChild(createCard(item, index));
  });
}

// ── Wire up "Show more" buttons ──────────────────────────────────────────────

document.getElementById("hospitals-more").addEventListener("click", () => showMore("hospitals"));
document.getElementById("police-more").addEventListener("click", () => showMore("police"));
document.getElementById("fire-more").addEventListener("click", () => showMore("fire"));

// ── Main button handler ──────────────────────────────────────────────────────

document.getElementById("find-btn").addEventListener("click", async () => {
  const btn    = document.getElementById("find-btn");
  const status = document.getElementById("status");

  btn.disabled       = true;
  btn.classList.add("loading");
  status.style.color = "";
  status.textContent = "Acquiring GPS fix… (up to 6 s)";

  try {
    // 0. Make sure local data is loaded
    await dataReady;
    if (!DATA_LOADED) throw "Facility data not available. Check facilities.json.";

    // 1. Get best available GPS fix
    const { lat, lon, accuracy } = await getUserLocation();
    status.textContent = `📍 Located (±${Math.round(accuracy)}m) — searching nearest facilities…`;

    // 2. Find nearest 50 of each category using Haversine
    const hospitals    = findNearest(lat, lon, "hospital", 50);
    const police       = findNearest(lat, lon, "police", 50);
    const fireStations = findNearest(lat, lon, "fire_station", 50);

    console.log(`🏥 Found ${hospitals.length} hospitals`);
    console.log(`👮 Found ${police.length} police stations`);
    console.log(`🚒 Found ${fireStations.length} fire stations`);

    // 3. Init map with user location + first 5 of each
    initMap(lat, lon, [
      { items: hospitals,    category: "hospital" },
      { items: police,       category: "police" },
      { items: fireStations, category: "fire_station" },
    ]);

    // 4. Init paginated sections (shows first 5 + "Show more" button)
    initSection("hospitals", hospitals, lat, lon);
    initSection("police",    police,    lat, lon);
    initSection("fire",      fireStations, lat, lon);
    buildEmergencyCards("emergency-list", EMERGENCY_NUMBERS);

    document.getElementById("results").style.display = "flex";
    const total = hospitals.length + police.length + fireStations.length;
    status.textContent = `📍 Located (±${Math.round(accuracy)}m) — ${total} facilities found nearby`;
    status.style.color = "#4dff91";

  } catch (err) {
    console.error("Error:", err);
    status.textContent = `⚠️ ${err}`;
    status.style.color = "#ff6b6b";
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
});

// ── PWA Installation Prompt ──────────────────────────────────────────────────

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('install-banner').style.display = 'flex';
});

document.getElementById('install-btn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      document.getElementById('install-banner').style.display = 'none';
    }
    deferredPrompt = null;
  }
});

// ── Download Map Area (10km) ─────────────────────────────────────────────────

// Math to convert lat/lon/zoom to OSM tile coordinates
function lon2tile(lon, zoom) { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
function lat2tile(lat, zoom) { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

document.getElementById("download-map-btn").addEventListener("click", async () => {
  if (!navigator.geolocation) return;
  const btn = document.getElementById("download-map-btn");
  const progressContainer = document.getElementById("download-progress-container");
  const progressBar = document.getElementById("download-progress-bar");
  const statusText = document.getElementById("download-status-text");

  btn.style.display = "none";
  progressContainer.style.display = "flex";
  statusText.textContent = "Getting location...";

  try {
    const { lat, lon } = await getUserLocation(3000);
    
    // 10km radius approximation in degrees
    const latOffset = 10 / 111; 
    const lonOffset = 10 / (111 * Math.cos(lat * Math.PI / 180));

    const minLat = lat - latOffset, maxLat = lat + latOffset;
    const minLon = lon - lonOffset, maxLon = lon + lonOffset;

    const urlsToFetch = [];
    // Zooms 13 to 16 for high detail
    for (let z = 13; z <= 16; z++) {
      const xMin = lon2tile(minLon, z), xMax = lon2tile(maxLon, z);
      const yMin = Math.min(lat2tile(maxLat, z), lat2tile(minLat, z)); // Note: lat tile numbers decrease as lat increases
      const yMax = Math.max(lat2tile(maxLat, z), lat2tile(minLat, z));

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          urlsToFetch.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
        }
      }
    }

    statusText.textContent = `Downloading ${urlsToFetch.length} tiles...`;
    
    // We rely on the service worker to actually save these to the `sos-tiles-v1` cache during the fetch.
    let downloaded = 0;

    // Download in batches to avoid overwhelming the browser/network
    const BATCH_SIZE = 10;
    for (let i = 0; i < urlsToFetch.length; i += BATCH_SIZE) {
      const batch = urlsToFetch.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (url) => {
        try {
          // fetch will be intercepted by SW and cached automatically
          const res = await fetch(url, { cache: "no-store" }); 
        } catch (e) {
          // Ignore individual tile failures
        }
      }));
      downloaded += batch.length;
      progressBar.style.width = `${Math.min(100, (downloaded / urlsToFetch.length) * 100)}%`;
      statusText.textContent = `${Math.min(downloaded, urlsToFetch.length)} / ${urlsToFetch.length}`;
    }

    statusText.textContent = "✅ Map saved offline!";
    setTimeout(() => { progressContainer.style.display = "none"; btn.style.display = "block"; btn.textContent = "✅ Map Saved (10km)"; }, 3000);

  } catch (err) {
    statusText.textContent = "❌ Error downloading map";
    setTimeout(() => { progressContainer.style.display = "none"; btn.style.display = "block"; }, 3000);
  }
});
