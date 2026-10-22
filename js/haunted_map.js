// =========================================================
// THE HAUNTED MAP - INTERACTIVE WEB MAP APPLICATION
// Draggable, map-anchored story cards & cartographic tour
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

let map = null;
let routeCoords = []; // Array of [lat, lng]
let creatureMarkers = []; // { marker, item }
let cardMarkersList = []; // { item, marker, leaderLine }
let routeLayers = [];
let graticuleLayer = null;
let countriesLayer = null;
let phantomMarker = null;

// Tour state
let tourActive = false;
let tourTimer = null;
let currentStopIndex = 0;

function initApp() {
  const data = window.HAUNTED_DATA;
  if (!data) {
    console.error('Haunted Map data bundle not found.');
    return;
  }

  initMap(data);
  buildDraggableCardMarkers(data);
  buildCountryLabels(data.countryLabels);
  drawInsetMinimap(data.world);
  initFogMist();
  initUIEvents(data);
  initTour(data);
}

// ---------------------------------------------------------
// 1. MAP INITIALIZATION (LEAFLET)
// ---------------------------------------------------------
function initMap(data) {
  const initialCenter = [50.8, 7.8];
  const initialZoom = 5;

  map = L.map('map-viewport', {
    center: initialCenter,
    zoom: initialZoom,
    zoomSnap: 0,
    zoomDelta: 0.25,
    minZoom: 3.5,
    maxZoom: 10,
    zoomControl: false,
    attributionControl: false,
    inertia: true
  });

  // Top-right zoom controls in explorer mode
  L.control.zoom({ position: 'topright' }).addTo(map);

  // 1. European countries polygon layer
  if (data.europe) {
    countriesLayer = L.geoJSON(data.europe, {
      style: {
        fillColor: '#3f3f41',
        fillOpacity: 1.0,
        color: '#222327',
        weight: 1.2,
        opacity: 1.0
      }
    }).addTo(map);
  }

  // 2. Graticule 5-degree grid lines
  if (data.graticules) {
    graticuleLayer = L.geoJSON(data.graticules, {
      style: {
        color: '#4e4e52',
        weight: 0.8,
        opacity: 0.5,
        dashArray: '2, 4'
      }
    }).addTo(map);
  }

  // 3. Spooky Haunted Route Line (15,000 points)
  if (data.route && data.route.features && data.route.features.length > 0) {
    const rawCoords = data.route.features[0].geometry.coordinates;
    routeCoords = rawCoords.map(c => [c[1], c[0]]);

    // Layer 1: Broad smoky orange/ember haze (widest outer ambient glow)
    const hazeGlow = L.polyline(routeCoords, {
      color: '#e67e22',
      weight: 22,
      opacity: 0.35,
      className: 'spooky-route-haze',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Layer 2: Glowing spectral ectoplasm aura (yellow/phosphor pulse)
    const outerGlow = L.polyline(routeCoords, {
      color: '#f0f921',
      weight: 11,
      opacity: 0.65,
      className: 'spooky-route-aura',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Layer 3: Wandering spirits stream (crawling ethereal dashed light along the road)
    const spiritStream = L.polyline(routeCoords, {
      color: '#ffffff',
      weight: 3.5,
      opacity: 0.85,
      className: 'spooky-route-spirits',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Layer 4: Intense bright spectral spine
    const innerSpine = L.polyline(routeCoords, {
      color: '#fefeed',
      weight: 2.0,
      opacity: 0.95,
      className: 'spooky-route-core',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    routeLayers = [hazeGlow, outerGlow, spiritStream, innerSpine];
  }

  // 4. Creature Pin Markers (1 through 7)
  data.folklore.forEach((item) => {
    const icon = L.divIcon({
      className: 'creature-marker-pin-wrapper',
      html: `<div class="creature-marker-pin" id="pin-${item.number}">${item.number}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([item.lat, item.lon], { icon, zIndexOffset: 800 }).addTo(map);

    marker.on('click', () => {
      selectStop(item.number, true);
    });

    marker.on('mouseover', () => {
      if (window.hauntedAudio) window.hauntedAudio.playWhisper();
      highlightCard(item.number);
      highlightLeader(item.number);
    });

    marker.on('mouseout', () => {
      unhighlightCards();
      unhighlightLeaders();
    });

    creatureMarkers.push({ marker, item });
  });

  // Default initial framing fitting exact 16:9 bounds
  const bounds = L.latLngBounds([
    [44.1743, -11.2083],
    [56.8752, 24.5995]
  ]);
  map.fitBounds(bounds, { padding: [10, 10] });
}

// ---------------------------------------------------------
// 2. DRAGGABLE & MAP-ANCHORED POSTER CARDS
// ---------------------------------------------------------
function buildDraggableCardMarkers(data) {
  // Clear any existing cards
  cardMarkersList.forEach(c => {
    map.removeLayer(c.marker);
    if (c.leaderLine) map.removeLayer(c.leaderLine);
  });
  cardMarkersList = [];

  // Load saved custom positions from localStorage
  let savedPositions = {};
  try {
    savedPositions = JSON.parse(localStorage.getItem('haunted_map_card_positions') || '{}');
  } catch (e) {
    savedPositions = {};
  }

  data.folklore.forEach(item => {
    // Determine position: saved user position or default calculated cartographic position
    const saved = savedPositions[item.number];
    const initialLat = saved && typeof saved.lat === 'number' ? saved.lat : item.cardLat;
    const initialLon = saved && typeof saved.lon === 'number' ? saved.lon : item.cardLon;

    // 1. Spooky Phantom Tether connecting feature location to card position
    const leaderLine = L.polyline([[item.lat, item.lon], [initialLat, initialLon]], {
      color: '#f5b041',
      weight: 2.0,
      dashArray: '6, 9',
      opacity: 0.85,
      className: 'card-leader-line',
      interactive: false
    }).addTo(map);

    // 2. Card Marker HTML (Clean layout with picture properly filling frame)
    const descWords = item.description.split(/\s+/).filter(w => w.length > 0);
    const tokenisedDesc = descWords.map((w, idx) => `<span class="lore-word" id="lore-word-${item.number}-${idx}">${w}</span>`).join(' ');

    const cardHtml = `
      <div class="folklore-card" id="card-${item.number}" title="Click to explore lore • Drag anywhere to move">
        <div class="card-title">
          <span>${item.title}</span>
        </div>
        <div class="card-image-box">
          <img src="${item.image}" alt="${item.title}" class="card-img-${item.number}" draggable="false" style="width:100% !important; height:100% !important; object-fit:cover !important; display:block !important;">
        </div>
        <div class="card-desc" id="card-desc-${item.number}">
          ${tokenisedDesc}
        </div>
      </div>
    `;

    const cardIcon = L.divIcon({
      className: 'folklore-card-leaflet-wrapper',
      html: cardHtml,
      iconSize: [215, 305],
      iconAnchor: [107, 152]
    });

    const cardMarker = L.marker([initialLat, initialLon], {
      draggable: true,
      icon: cardIcon,
      zIndexOffset: 650
    }).addTo(map);

    let dragStarted = false;
    let dragStartPos = null;

    cardMarker.on('dragstart', (e) => {
      dragStarted = true;
      dragStartPos = cardMarker.getLatLng();
      const cardEl = document.getElementById(`card-${item.number}`);
      if (cardEl) cardEl.classList.add('dragging');
      leaderLine.setStyle({ color: '#f0f921', weight: 3.2, opacity: 1.0 });
      highlightPin(item.number);
      if (window.hauntedAudio) window.hauntedAudio.playWhisper();
    });

    cardMarker.on('drag', () => {
      const pos = cardMarker.getLatLng();
      leaderLine.setLatLngs([[item.lat, item.lon], [pos.lat, pos.lng]]);
    });

    cardMarker.on('dragend', () => {
      const finalPos = cardMarker.getLatLng();
      const cardEl = document.getElementById(`card-${item.number}`);
      if (cardEl) cardEl.classList.remove('dragging');
      leaderLine.setStyle({ color: '#f5b041', weight: 2.0, opacity: 0.85 });
      
      // Save position to localStorage
      saveCardPosition(item.number, finalPos.lat, finalPos.lng);

      setTimeout(() => {
        dragStarted = false;
      }, 100);
    });

    // Hover styling
    cardMarker.on('mouseover', () => {
      highlightPin(item.number);
      highlightCard(item.number);
      leaderLine.setStyle({ color: '#f0f921', weight: 2.8, opacity: 1.0 });
      if (window.hauntedAudio) window.hauntedAudio.playWhisper();
    });

    cardMarker.on('mouseout', () => {
      if (!dragStarted) {
        const cardEl = document.getElementById(`card-${item.number}`);
        if (cardEl && cardEl.classList.contains('reading-active')) {
          return; // Keep highlighted while being spoken by spooky voice
        }
        unhighlightPins();
        unhighlightCards();
        unhighlightLeaders();
      }
    });

    // Click on card opens Grimoire drawer & triggers spooky narration
    cardMarker.on('click', () => {
      if (!dragStarted) {
        selectStop(item.number, true, true);
      }
    });

    cardMarkersList.push({ item, marker: cardMarker, leaderLine });
  });
}

function saveCardPosition(number, lat, lon) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('haunted_map_card_positions') || '{}');
  } catch (e) {
    saved = {};
  }
  saved[number] = { lat, lon };
  localStorage.setItem('haunted_map_card_positions', JSON.stringify(saved));
}

function resetCardPositions() {
  localStorage.removeItem('haunted_map_card_positions');
  cardMarkersList.forEach(({ item, marker, leaderLine }) => {
    const origLatLng = L.latLng(item.cardLat, item.cardLon);
    marker.setLatLng(origLatLng);
    if (leaderLine) {
      leaderLine.setLatLngs([[item.lat, item.lon], [item.cardLat, item.cardLon]]);
    }
  });
  if (window.hauntedAudio) {
    window.hauntedAudio.playBell(1.15);
  }
}

// ---------------------------------------------------------
// 3. HIGHLIGHT HELPERS
// ---------------------------------------------------------
function getActiveNarrationStopNumber() {
  const narrator = window.spookyNarrator;
  if (narrator && (narrator.isSpeaking || narrator.isPaused) && narrator.activeStopNumber) {
    return narrator.activeStopNumber;
  }
  return null;
}

function highlightPin(number) {
  const pin = document.getElementById(`pin-${number}`);
  if (pin) pin.classList.add('active');
}

function unhighlightPins() {
  const activeStop = getActiveNarrationStopNumber();
  document.querySelectorAll('.creature-marker-pin').forEach(p => {
    if (activeStop && p.id === `pin-${activeStop}`) return;
    p.classList.remove('active');
  });
}

function highlightCard(number) {
  const card = document.getElementById(`card-${number}`);
  if (card) card.classList.add('highlighted');
}

function unhighlightCards() {
  document.querySelectorAll('.folklore-card').forEach(c => {
    if (!c.classList.contains('reading-active')) {
      c.classList.remove('highlighted');
    }
  });
}

function highlightLeader(number) {
  const found = cardMarkersList.find(c => c.item.number === number);
  if (found && found.leaderLine) {
    found.leaderLine.setStyle({ color: '#f0f921', weight: 2.5, opacity: 0.95 });
  }
}

function unhighlightLeaders() {
  const activeStop = getActiveNarrationStopNumber();
  cardMarkersList.forEach(c => {
    if (c.leaderLine) {
      if (activeStop && c.item.number === activeStop) {
        c.leaderLine.setStyle({ color: '#f0f921', weight: 2.5, opacity: 0.95 });
      } else {
        c.leaderLine.setStyle({ color: '#f5b041', weight: 2.0, opacity: 0.85 });
      }
    }
  });
}

function syncVisitedStopsForDistance(dist, includeCurrentAtDist = false) {
  visitedStops.clear();
  for (let i = 0; i < stopDistances.length; i++) {
    const sd = stopDistances[i];
    if (sd.distance < dist - 25000 || (includeCurrentAtDist && Math.abs(sd.distance - dist) <= 25000)) {
      visitedStops.add(sd.stop.number);
    }
  }
}

function triggerStopNarration(item, continueTourAfter = false) {
  if (window.spookyNarrator && window.spookyNarrator.enabled) {
    if (continueTourAfter) {
      tourPausedForSpeech = true;
      window.tourPausedForSpeech = true;
      pauseTour(false /* paused for speech, keep speech alive */);
    }

    window.spookyNarrator.readStop(item, () => {
      if (tourPausedForSpeech) {
        // If at the final stop at the end of the route, finish the tour cleanly
        if (currentTourDistance >= totalRouteDistance - 1000) {
          pauseTour(true);
          return;
        }
        // Short eerie pause before continuing along the road
        speechResumeTimeout = setTimeout(() => {
          speechResumeTimeout = null;
          if (!tourActive && tourPausedForSpeech) {
            tourPausedForSpeech = false;
            window.tourPausedForSpeech = false;
            startTour();
          }
        }, 800);
      }
    });
  }
}

// Select a stop
function selectStop(number, openDrawer = true, shouldSpeak = true, continueTourAfter = false) {
  const data = window.HAUNTED_DATA;
  const item = data.folklore.find(f => f.number === number);
  if (!item) return;

  if (!continueTourAfter) {
    if (speechResumeTimeout) {
      clearTimeout(speechResumeTimeout);
      speechResumeTimeout = null;
    }
    if (tourActive) {
      pauseTour(false);
    }
    tourPausedForSpeech = false;
    window.tourPausedForSpeech = false;
  }

  currentStopIndex = number - 1;
  const target = stopDistances[currentStopIndex];
  if (target) {
    currentTourDistance = target.distance;
    syncVisitedStopsForDistance(currentTourDistance, true);
    updateTourPosition(false);
  }

  if (window.spookyNarrator) {
    if (!shouldSpeak || !window.spookyNarrator.enabled) {
      window.spookyNarrator.stop();
    } else {
      window.spookyNarrator.activeStopNumber = number;
    }
  }

  document.querySelectorAll('.creature-marker-pin').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.folklore-card').forEach(c => c.classList.remove('highlighted', 'reading-active'));
  cardMarkersList.forEach(c => {
    if (c.leaderLine) {
      c.leaderLine.setStyle({ color: '#f5b041', weight: 2.0, opacity: 0.85 });
    }
  });

  highlightPin(number);
  highlightCard(number);
  highlightLeader(number);

  if (window.hauntedAudio) {
    window.hauntedAudio.playBell(1.0 - (number * 0.05));
  }

  // Smoothly center the map on this stop
  map.flyTo([item.lat, item.lon], 7, {
    duration: 1.2,
    easeLinearity: 0.25
  });

  updateTourDockInfo(item);

  if (openDrawer) {
    openGrimoire(item);
  }

  if (shouldSpeak && window.spookyNarrator && window.spookyNarrator.enabled) {
    triggerStopNarration(item, continueTourAfter);
  }
}

// ---------------------------------------------------------
// 4. COUNTRY LABELS
// ---------------------------------------------------------
function buildCountryLabels(labels) {
  if (!labels) return;
  labels.forEach(loc => {
    const icon = L.divIcon({
      className: 'country-label-container',
      html: `<div class="map-country-label">${loc.name}</div>`,
      iconSize: [120, 24],
      iconAnchor: [60, 12]
    });
    L.marker([loc.lat, loc.lon], { icon, interactive: false }).addTo(map);
  });
}

// ---------------------------------------------------------
// 5. GRIMOIRE (LORE DRAWER) & LIGHTBOX
// ---------------------------------------------------------
function openGrimoire(item) {
  const drawer = document.getElementById('grimoire-drawer');
  if (!drawer) return;

  const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
  const romanNum = romanNumerals[item.number - 1] || `${item.number}`;
  const folioNum = document.getElementById('grimoire-folio-num');
  if (folioNum) {
    folioNum.textContent = `FOLIO ${romanNum}`;
  }

  const cleanTitle = (item.title || '').replace(/^\d+[\.\s\-]+/, '');
  document.getElementById('grimoire-title').textContent = `${item.number}. ${cleanTitle}`;
  document.getElementById('grimoire-location').textContent = `${item.location} • Chronicle No. ${item.number}`;
  
  const heroImg = document.getElementById('grimoire-hero-img');
  heroImg.src = item.image;
  heroImg.onclick = () => openLightbox(item.image, item.title);

  document.getElementById('grimoire-desc').textContent = item.description;
  document.getElementById('grimoire-lore').textContent = item.extendedLore;

  // Build gallery grid
  const galleryGrid = document.getElementById('grimoire-gallery');
  galleryGrid.innerHTML = '';
  if (item.gallery && item.gallery.length > 0) {
    item.gallery.forEach(imgUrl => {
      const thumb = document.createElement('div');
      thumb.className = 'gallery-thumb';
      thumb.innerHTML = `<img src="${imgUrl}" alt="${item.title}">`;
      thumb.onclick = () => openLightbox(imgUrl, item.title);
      galleryGrid.appendChild(thumb);
    });
  }

  drawer.classList.add('open');
}

function closeGrimoire() {
  const drawer = document.getElementById('grimoire-drawer');
  if (drawer) drawer.classList.remove('open');
}

function openLightbox(src, caption) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  img.src = src;
  cap.textContent = caption || '';
  modal.classList.add('open');
}

function closeLightbox() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) modal.classList.remove('open');
}

// ---------------------------------------------------------
// 6. INSET MINIMAP (WORLD WITH EUROPE HIGHLIGHT)
// ---------------------------------------------------------
function drawInsetMinimap(worldGeo) {
  const canvas = document.getElementById('inset-map-canvas');
  if (!canvas || !worldGeo) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;

  ctx.fillStyle = '#17181c';
  ctx.fillRect(0, 0, w, h);

  function project(lon, lat) {
    const x = ((lon + 180) / 360) * w;
    const y = ((90 - lat) / 180) * h;
    return [x, y];
  }

  ctx.fillStyle = '#343538';
  ctx.strokeStyle = '#222326';
  ctx.lineWidth = 1;

  worldGeo.features.forEach(feat => {
    const geom = feat.geometry;
    if (!geom) return;

    ctx.beginPath();
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

    polys.forEach(poly => {
      poly.forEach(ring => {
        ring.forEach((pt, i) => {
          const [px, py] = project(pt[0], pt[1]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
      });
    });
    ctx.fill();
    ctx.stroke();
  });

  // Highlight bounding box
  const [x1, y1] = project(-11.5, 57.5);
  const [x2, y2] = project(26.0, 43.5);

  ctx.strokeStyle = '#f5b041';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

  ctx.fillStyle = 'rgba(240, 192, 90, 0.18)';
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
}

// ---------------------------------------------------------
// ---------------------------------------------------------
// 7. HAUNTED JOURNEY ANIMATED ROUTE TOUR (Continuous Distance Interpolation)
// ---------------------------------------------------------
let routeDistances = [];
let totalRouteDistance = 0;
let stopDistances = [];
let currentTourDistance = 0;
let lastFrameTimestamp = null;
let tourSpeedMps = 100000; // ~38 seconds for entire 3,817km European journey
let visitedStops = new Set();

function precalculateRouteDistances() {
  routeDistances = [0];
  totalRouteDistance = 0;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const p1 = routeCoords[i];
    const p2 = routeCoords[i + 1];
    const latMid = (p1[0] + p2[0]) * 0.5 * (Math.PI / 180.0);
    const dx = (p2[1] - p1[1]) * 111320.0 * Math.cos(latMid);
    const dy = (p2[0] - p1[0]) * 111320.0;
    const d = Math.hypot(dx, dy);
    totalRouteDistance += d;
    routeDistances.push(totalRouteDistance);
  }

  // Precalculate closest distance along the route for each of the 7 folklore stops
  const folklore = window.HAUNTED_DATA.folklore;
  stopDistances = folklore.map(stop => {
    let minD = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = Math.hypot(routeCoords[i][0] - stop.lat, routeCoords[i][1] - stop.lon);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    return {
      stop,
      index: bestIdx,
      distance: routeDistances[bestIdx]
    };
  });
}

function getPointAtDistance(dist) {
  if (dist <= 0) {
    const p1 = routeCoords[0];
    const p2 = routeCoords[1] || p1;
    const latMid = (p1[0] + p2[0]) * 0.5 * (Math.PI / 180.0);
    const dx = (p2[1] - p1[1]) * Math.cos(latMid);
    const dy = p2[0] - p1[0];
    const angle = Math.atan2(dx, dy) * (180 / Math.PI);
    return { lat: p1[0], lon: p1[1], angle, index: 0 };
  }

  if (dist >= totalRouteDistance) {
    const n = routeCoords.length;
    const p1 = routeCoords[n - 2] || routeCoords[n - 1];
    const p2 = routeCoords[n - 1];
    const latMid = (p1[0] + p2[0]) * 0.5 * (Math.PI / 180.0);
    const dx = (p2[1] - p1[1]) * Math.cos(latMid);
    const dy = p2[0] - p1[0];
    const angle = Math.atan2(dx, dy) * (180 / Math.PI);
    return { lat: p2[0], lon: p2[1], angle, index: n - 1 };
  }

  // Fast binary search to find exact route segment
  let low = 0;
  let high = routeDistances.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (routeDistances[mid] <= dist) {
      if (mid === routeDistances.length - 1 || dist < routeDistances[mid + 1]) {
        low = mid;
        break;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const i = low;
  const d1 = routeDistances[i];
  const d2 = routeDistances[i + 1] || d1;
  const segLen = d2 - d1;
  const t = segLen > 0 ? (dist - d1) / segLen : 0;

  const p1 = routeCoords[i];
  const p2 = routeCoords[i + 1] || p1;

  // Exact linear interpolation along this polyline segment
  const lat = p1[0] + t * (p2[0] - p1[0]);
  const lon = p1[1] + t * (p2[1] - p1[1]);

  // Heading angle (pointing north = 0 deg, east = 90 deg)
  const latMid = (p1[0] + p2[0]) * 0.5 * (Math.PI / 180.0);
  const dx = (p2[1] - p1[1]) * Math.cos(latMid);
  const dy = p2[0] - p1[0];
  const angle = Math.atan2(dx, dy) * (180 / Math.PI);

  return { lat, lon, angle, index: i };
}

function initTour(data) {
  const playBtn = document.getElementById('tour-play-btn');
  const prevBtn = document.getElementById('tour-prev-btn');
  const nextBtn = document.getElementById('tour-next-btn');
  const progressContainer = document.getElementById('tour-progress-container');

  if (routeCoords.length === 0) return;

  precalculateRouteDistances();

  // Create clean spectral cursor marker (centered exactly on coordinates)
  const spectralIcon = L.divIcon({
    className: 'spectral-marker-wrapper',
    html: `
      <div class="spectral-cursor-container">
        <div class="spectral-cursor-glow"></div>
        <svg id="spectral-cursor-svg" class="spectral-cursor-icon" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="14" fill="rgba(240, 249, 33, 0.25)" stroke="#f0f921" stroke-width="1.5" stroke-dasharray="2, 2"/>
          <path d="M18 4 L26 24 L18 20 L10 24 Z" fill="url(#ghostFlame)" stroke="#ffe1aa" stroke-width="1.2"/>
          <circle cx="18" cy="18" r="4.5" fill="#fefeed"/>
          <defs>
            <linearGradient id="ghostFlame" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fefeed"/>
              <stop offset="40%" stop-color="#f0f921"/>
              <stop offset="100%" stop-color="#e67e22"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  phantomMarker = L.marker(routeCoords[0], { icon: spectralIcon, zIndexOffset: 1200 }).addTo(map);

  playBtn.addEventListener('click', () => {
    const narrator = window.spookyNarrator;
    const isSpeaking = narrator && narrator.isSpeaking;
    const isPaused = narrator && narrator.isPaused;

    if (isSpeaking) {
      // Pause description narration in place (preserving tourPausedForSpeech if mid-tour)
      narrator.pause();
    } else if (isPaused) {
      // Resume description narration from where it was paused
      narrator.resume();
    } else if (tourActive || tourPausedForSpeech || speechResumeTimeout) {
      pauseTour(true);
    } else {
      startTour();
    }
  });

  prevBtn.addEventListener('click', () => {
    stepTour(-1);
  });

  nextBtn.addEventListener('click', () => {
    stepTour(1);
  });

  const voiceBtn = document.getElementById('tour-voice-btn');
  if (voiceBtn && window.spookyNarrator) {
    const savedVoice = localStorage.getItem('haunted_voice_enabled');
    if (savedVoice !== null) {
      window.spookyNarrator.enabled = savedVoice === '1';
    }
    const isVoiceOn = window.spookyNarrator.enabled;
    voiceBtn.classList.toggle('active', isVoiceOn);
    voiceBtn.classList.toggle('muted', !isVoiceOn);
    voiceBtn.title = `Toggle Spooky Voice (Currently: ${isVoiceOn ? 'ON' : 'OFF'})`;

    voiceBtn.addEventListener('click', () => {
      const isEnabled = window.spookyNarrator.toggleEnabled();
      localStorage.setItem('haunted_voice_enabled', isEnabled ? '1' : '0');
      if (isEnabled) {
        voiceBtn.classList.add('active');
        voiceBtn.classList.remove('muted');
        voiceBtn.title = 'Toggle Spooky Voice (Currently: ON)';
      } else {
        voiceBtn.classList.remove('active');
        voiceBtn.classList.add('muted');
        voiceBtn.title = 'Toggle Spooky Voice (Currently: OFF)';
        if (tourPausedForSpeech) {
          tourPausedForSpeech = false;
          window.tourPausedForSpeech = false;
          if (speechResumeTimeout) {
            clearTimeout(speechResumeTimeout);
            speechResumeTimeout = null;
          }
          startTour();
        }
      }
    });
  }

  const voiceSelect = document.getElementById('spooky-voice-select');
  if (voiceSelect) {
    voiceSelect.addEventListener('change', (e) => {
      window.spookyNarrator.setVoiceStyle(e.target.value);
    });
  }

  const stopNarrationBtn = document.getElementById('narration-stop-btn');
  if (stopNarrationBtn) {
    stopNarrationBtn.addEventListener('click', () => {
      if (speechResumeTimeout) {
        clearTimeout(speechResumeTimeout);
        speechResumeTimeout = null;
      }
      tourPausedForSpeech = false;
      window.tourPausedForSpeech = false;
      window.spookyNarrator.stop();
      if (!tourActive) {
        const playBtn = document.getElementById('tour-play-btn');
        if (playBtn) playBtn.innerHTML = '▶';
      }
    });
  }

  progressContainer.addEventListener('click', (e) => {
    const wasTouring = tourActive || tourPausedForSpeech || Boolean(speechResumeTimeout);
    if (speechResumeTimeout) {
      clearTimeout(speechResumeTimeout);
      speechResumeTimeout = null;
    }
    tourPausedForSpeech = false;
    window.tourPausedForSpeech = false;
    if (window.spookyNarrator) window.spookyNarrator.stop();

    const rect = progressContainer.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    currentTourDistance = ratio * totalRouteDistance;
    syncVisitedStopsForDistance(currentTourDistance, false);

    // Update current stop label to the stop at or most recently passed
    let latestIdx = 0;
    for (let i = 0; i < stopDistances.length; i++) {
      if (stopDistances[i].distance <= currentTourDistance + 25000) {
        latestIdx = i;
      }
    }
    currentStopIndex = latestIdx;
    if (stopDistances[currentStopIndex]) {
      updateTourDockInfo(stopDistances[currentStopIndex].stop);
    }

    updateTourPosition();

    if (wasTouring && !tourActive) {
      startTour();
    } else if (!wasTouring) {
      const playBtn = document.getElementById('tour-play-btn');
      if (playBtn) playBtn.innerHTML = '▶';
    }
  });

  // Initialize marker at start
  updateTourPosition(false);
}

let tourPausedForSpeech = false;
let speechResumeTimeout = null;
window.tourActive = false;
window.tourPausedForSpeech = false;

function startTour() {
  if (speechResumeTimeout) {
    clearTimeout(speechResumeTimeout);
    speechResumeTimeout = null;
  }
  tourActive = true;
  window.tourActive = true;
  tourPausedForSpeech = false;
  window.tourPausedForSpeech = false;
  const playBtn = document.getElementById('tour-play-btn');
  if (playBtn) playBtn.innerHTML = '❚❚';

  // If already at end, wrap to start
  if (currentTourDistance >= totalRouteDistance - 1000) {
    currentTourDistance = 0;
    visitedStops.clear();
    updateTourPosition();
  }

  // Check immediately if starting at an unvisited stop (e.g., Stop 1 at distance 0)
  checkStopArrival();
  if (!tourActive) return;

  lastFrameTimestamp = performance.now();

  function tick(timestamp) {
    if (!tourActive) return;

    const dt = Math.min((timestamp - lastFrameTimestamp) / 1000, 0.1);
    lastFrameTimestamp = timestamp;

    currentTourDistance += tourSpeedMps * dt;

    if (currentTourDistance >= totalRouteDistance) {
      currentTourDistance = totalRouteDistance;
      updateTourPosition();
      checkStopArrival();
      if (tourActive) {
        pauseTour(true);
      }
      return;
    }

    updateTourPosition();
    checkStopArrival();

    if (tourActive) {
      tourTimer = requestAnimationFrame(tick);
    }
  }

  tourTimer = requestAnimationFrame(tick);
}

function pauseTour(userInitiated = true) {
  tourActive = false;
  window.tourActive = false;
  if (tourTimer) {
    cancelAnimationFrame(tourTimer);
    tourTimer = null;
  }
  lastFrameTimestamp = null;

  if (speechResumeTimeout) {
    clearTimeout(speechResumeTimeout);
    speechResumeTimeout = null;
  }

  if (userInitiated) {
    tourPausedForSpeech = false;
    window.tourPausedForSpeech = false;
    const playBtn = document.getElementById('tour-play-btn');
    if (playBtn) playBtn.innerHTML = '▶';
    if (window.spookyNarrator) {
      window.spookyNarrator.stop();
    }
  }
}

function updateTourPosition(shouldPan = true) {
  if (currentTourDistance < 0) currentTourDistance = 0;
  if (currentTourDistance > totalRouteDistance) currentTourDistance = totalRouteDistance;

  const pt = getPointAtDistance(currentTourDistance);
  phantomMarker.setLatLng([pt.lat, pt.lon]);

  // Smoothly rotate the cursor arrow to face the road heading
  const svgEl = document.getElementById('spectral-cursor-svg');
  if (svgEl) {
    svgEl.style.transform = `rotate(${pt.angle}deg)`;
  }

  const pct = totalRouteDistance > 0 ? (currentTourDistance / totalRouteDistance) * 100 : 0;
  document.getElementById('tour-progress-bar').style.width = `${pct}%`;

  // Only pan map in Explorer View (in Poster View keep framing steady for full-poster viewing)
  const isExplorer = document.getElementById('mode-explorer-btn')?.classList.contains('active');
  if (shouldPan && isExplorer) {
    map.panTo([pt.lat, pt.lon], { animate: true, duration: 0.15 });
  }
}

function checkStopArrival() {
  // If user scrubbed backwards, clear visited stops ahead of current position
  for (let i = 0; i < stopDistances.length; i++) {
    if (stopDistances[i].distance > currentTourDistance + 15000) {
      visitedStops.delete(stopDistances[i].stop.number);
    }
  }

  for (let i = 0; i < stopDistances.length; i++) {
    const sd = stopDistances[i];
    const diff = Math.abs(currentTourDistance - sd.distance);
    // If within 25km of the stop along the road
    if (diff < 25000 && !visitedStops.has(sd.stop.number)) {
      visitedStops.add(sd.stop.number);
      currentStopIndex = i;

      // Snap cursor exactly to the stop position
      currentTourDistance = sd.distance;
      updateTourPosition();

      unhighlightPins();
      unhighlightCards();
      unhighlightLeaders();

      highlightPin(sd.stop.number);
      highlightCard(sd.stop.number);
      highlightLeader(sd.stop.number);
      updateTourDockInfo(sd.stop);

      if (window.hauntedAudio) {
        window.hauntedAudio.playBell(1.0 - (sd.stop.number * 0.05));
      }

      // Check if Spooky Voice narration is active
      if (window.spookyNarrator && window.spookyNarrator.enabled) {
        triggerStopNarration(sd.stop, tourActive);
      }
      break;
    }
  }
}

function stepTour(direction) {
  const wasTouring = tourActive || tourPausedForSpeech || Boolean(speechResumeTimeout);
  if (speechResumeTimeout) {
    clearTimeout(speechResumeTimeout);
    speechResumeTimeout = null;
  }
  if (tourActive) {
    pauseTour(false);
  }
  tourPausedForSpeech = false;
  window.tourPausedForSpeech = false;

  const currStopDist = stopDistances[currentStopIndex] ? stopDistances[currentStopIndex].distance : 0;
  const isBetweenStops = currentTourDistance > currStopDist + 25000;
  if (direction < 0 && isBetweenStops) {
    // Cursor has moved past currentStopIndex; step back to currentStopIndex
  } else {
    currentStopIndex += direction;
  }

  if (currentStopIndex < 0) currentStopIndex = stopDistances.length - 1;
  if (currentStopIndex >= stopDistances.length) currentStopIndex = 0;

  const target = stopDistances[currentStopIndex];
  if (target) {
    const isVoiceOn = Boolean(window.spookyNarrator && window.spookyNarrator.enabled);
    selectStop(target.stop.number, false, true, wasTouring && isVoiceOn);
    if (wasTouring && !isVoiceOn) {
      startTour();
    } else if (!wasTouring && !isVoiceOn) {
      const playBtn = document.getElementById('tour-play-btn');
      if (playBtn) playBtn.innerHTML = '▶';
    }
  }
}

function updateTourDockInfo(item) {
  document.getElementById('tour-curr-stop-label').textContent = `${item.number}. ${item.shortTitle} (${item.country})`;
}

// ---------------------------------------------------------
// 8. DRIFTING FOG / MIST CANVAS
// ---------------------------------------------------------
function initFogMist() {
  const canvas = document.getElementById('fog-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const particles = [];
  const particleCount = 28;

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 90 + Math.random() * 140,
      vx: 0.15 + Math.random() * 0.35,
      vy: (Math.random() - 0.5) * 0.1,
      alpha: 0.04 + Math.random() * 0.08
    });
  }

  function renderMist() {
    ctx.clearRect(0, 0, width, height);

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x - p.radius > width) p.x = -p.radius;
      if (p.y - p.radius > height) p.y = -p.radius;
      if (p.y + p.radius < 0) p.y = height + p.radius;

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
      grad.addColorStop(0, `rgba(200, 205, 215, ${p.alpha})`);
      grad.addColorStop(1, 'rgba(200, 205, 215, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(renderMist);
  }

  renderMist();
}

// ---------------------------------------------------------
// 9. UI EVENTS & MODE TOGGLES
// ---------------------------------------------------------
function initUIEvents(data) {
  // Mode switcher (Poster View vs Full Explorer View)
  const posterBtn = document.getElementById('mode-poster-btn');
  const explorerBtn = document.getElementById('mode-explorer-btn');
  const posterOverlay = document.getElementById('poster-overlay');
  const layerPanel = document.getElementById('map-layer-panel');

  posterBtn.addEventListener('click', () => {
    posterBtn.classList.add('active');
    explorerBtn.classList.remove('active');
    posterOverlay.style.display = 'block';
    layerPanel.classList.remove('visible');

    map.flyToBounds([
      [44.1743, -11.2083],
      [56.8752, 24.5995]
    ], { padding: [10, 10], duration: 1.0 });
  });

  explorerBtn.addEventListener('click', () => {
    explorerBtn.classList.add('active');
    posterBtn.classList.remove('active');
    posterOverlay.style.display = 'none';
    layerPanel.classList.add('visible');
  });

  // Audio Toggle
  const audioBtn = document.getElementById('audio-toggle-btn');
  if (audioBtn) {
    const savedAudioMuted = localStorage.getItem('haunted_audio_muted');
    const isMuted = savedAudioMuted === null ? true : savedAudioMuted === '1';
    if (window.hauntedAudio) {
      window.hauntedAudio.isMuted = isMuted;
    }
    audioBtn.classList.toggle('active', !isMuted);
    audioBtn.innerHTML = !isMuted ? '🔔 Audio: On' : '🔕 Audio: Off';

    if (!isMuted && window.hauntedAudio) {
      const unlockAudio = (e) => {
        if (e.target && e.target.closest && e.target.closest('#audio-toggle-btn')) return;
        if (!window.hauntedAudio.isMuted) {
          window.hauntedAudio.init();
          if (window.hauntedAudio.ctx && window.hauntedAudio.ctx.state === 'suspended') {
            window.hauntedAudio.ctx.resume();
          }
        }
      };
      window.addEventListener('pointerdown', unlockAudio, { once: true });
      window.addEventListener('keydown', unlockAudio, { once: true });
    }

    audioBtn.addEventListener('click', () => {
      if (window.hauntedAudio) {
        const isSounding = window.hauntedAudio.toggleSound();
        audioBtn.classList.toggle('active', isSounding);
        audioBtn.innerHTML = isSounding ? '🔔 Audio: On' : '🔕 Audio: Off';
        localStorage.setItem('haunted_audio_muted', isSounding ? '0' : '1');
      }
    });
  }

  // Reset Cards Button
  document.getElementById('reset-cards-btn').addEventListener('click', () => {
    resetCardPositions();
  });

  // Reset Framing Button
  document.getElementById('reset-view-btn').addEventListener('click', () => {
    map.flyToBounds([
      [44.1743, -11.2083],
      [56.8752, 24.5995]
    ], { padding: [10, 10], duration: 1.0 });
  });

  // Article Box Minimize / Expand Toggle
  const articleToggleBtn = document.getElementById('article-toggle-btn');
  const articleContent = document.getElementById('poster-article-content');
  if (articleToggleBtn && articleContent) {
    articleToggleBtn.addEventListener('click', () => {
      const isCollapsed = articleContent.style.display === 'none';
      articleContent.style.display = isCollapsed ? 'block' : 'none';
      articleToggleBtn.textContent = isCollapsed ? '─' : '+';
    });
  }

  // Layer toggles
  document.getElementById('toggle-route').addEventListener('change', (e) => {
    routeLayers.forEach(l => {
      if (e.target.checked) map.addLayer(l);
      else map.removeLayer(l);
    });
  });

  document.getElementById('toggle-graticule').addEventListener('change', (e) => {
    if (e.target.checked) map.addLayer(graticuleLayer);
    else map.removeLayer(graticuleLayer);
  });

  document.getElementById('toggle-cards').addEventListener('change', (e) => {
    cardMarkersList.forEach(c => {
      if (e.target.checked) map.addLayer(c.marker);
      else map.removeLayer(c.marker);
    });
  });

  document.getElementById('toggle-leaders').addEventListener('change', (e) => {
    cardMarkersList.forEach(c => {
      if (c.leaderLine) {
        if (e.target.checked) map.addLayer(c.leaderLine);
        else map.removeLayer(c.leaderLine);
      }
    });
  });

  document.getElementById('toggle-mist').addEventListener('change', (e) => {
    document.getElementById('fog-canvas').style.display = e.target.checked ? 'block' : 'none';
  });

  // Grimoire Close
  document.getElementById('grimoire-close-btn').addEventListener('click', closeGrimoire);

  // Lightbox Close
  document.getElementById('lightbox-close-btn').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLightbox();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      closeGrimoire();
    }
  });
}
