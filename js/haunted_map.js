// =========================================================
// THE HAUNTED MAP - INTERACTIVE WEB MAP APPLICATION
// Multi-Edition Gothic Cartography, Global Cryptids & Tour
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
let countryLabelMarkers = [];

// Active Edition & Poster State
let currentEdition = 'europe';
let currentPoster = null;

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
  initMapNavigationPanel(data.world);
  initFogMist();
  initTour(data);
  initUIEvents(data);

  // Restore saved edition or default to Europe
  let savedEdition = 'europe';
  try {
    savedEdition = localStorage.getItem('haunted_map_active_edition') || 'europe';
  } catch (e) {
    savedEdition = 'europe';
  }
  if (!data.posters || !data.posters[savedEdition]) {
    savedEdition = 'europe';
  }

  switchEdition(savedEdition, false);
}

// ---------------------------------------------------------
// 1. MAP INITIALIZATION (LEAFLET - GLOBAL EXTENSION)
// ---------------------------------------------------------
function initMap(data) {
  const initialCenter = [50.8, 7.8];
  const initialZoom = 5;

  map = L.map('map-viewport', {
    center: initialCenter,
    zoom: initialZoom,
    zoomSnap: 0,
    zoomDelta: 0.25,
    minZoom: 1.8,
    maxZoom: 10,
    zoomControl: false,
    attributionControl: false,
    inertia: true,
    worldCopyJump: true
  });

  // Top-right zoom controls in explorer mode
  L.control.zoom({ position: 'topright' }).addTo(map);

  // 1. World countries polygon layer (covers all 258 countries across the globe in gothic theme)
  const worldGeo = data.world || data.europe;
  if (worldGeo) {
    countriesLayer = L.geoJSON(worldGeo, {
      style: {
        fillColor: '#3f3f41',
        fillOpacity: 1.0,
        color: '#222327',
        weight: 1.2,
        opacity: 1.0
      }
    }).addTo(map);
  }

  // 2. Graticule grid lines (spans the entire globe)
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
}

// Reset view to active poster's optimal framing
function resetCurrentPosterFraming() {
  if (!currentPoster || !currentPoster.bounds) {
    map.flyToBounds([
      [44.1743, -11.2083],
      [56.8752, 24.5995]
    ], { padding: [15, 15], duration: 1.0 });
    return;
  }
  const b = currentPoster.bounds;
  map.flyToBounds([
    [b.south, b.west],
    [b.north, b.east]
  ], { padding: [15, 15], duration: 1.0 });
}

// Switch between Gothic Cartographic Poster Editions
function switchEdition(editionId, animate = true) {
  const data = window.HAUNTED_DATA;
  if (!data || !data.posters || !data.posters[editionId]) return;

  // Stop active tour & narration before switching
  if (tourActive) pauseTour(true);
  if (window.spookyNarrator) window.spookyNarrator.stop();

  currentEdition = editionId;
  currentPoster = data.posters[editionId];
  try {
    localStorage.setItem('haunted_map_active_edition', editionId);
  } catch (e) {}

  // 1. Update Header Brand Subtitle & Poster Title
  const brandSub = document.getElementById('header-brand-subtitle');
  if (brandSub) brandSub.textContent = currentPoster.headerSubtitle || currentPoster.subtitle;

  const posterTitle = document.getElementById('poster-title');
  if (posterTitle) posterTitle.textContent = currentPoster.title;

  const posterSub = document.getElementById('poster-subtitle');
  if (posterSub) posterSub.textContent = currentPoster.subtitle;

  // 2. Update Folklore Heritage Narrative Box
  if (currentPoster.article) {
    const badge = document.getElementById('poster-article-badge');
    const p1 = document.getElementById('poster-article-p1');
    const p2 = document.getElementById('poster-article-p2');
    const cit = document.getElementById('poster-article-citation');
    if (badge) badge.textContent = currentPoster.article.badge || 'Folklore Heritage';
    if (p1) p1.textContent = currentPoster.article.p1 || '';
    if (p2) p2.textContent = currentPoster.article.p2 || '';
    if (cit) cit.textContent = currentPoster.article.citation || '';
  }

  // 3. Update Dropdown and Pill states
  document.querySelectorAll('.edition-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-edition') === editionId);
  });
  const selectEl = document.getElementById('edition-select');
  if (selectEl) selectEl.value = editionId;

  // 4. Build Layers for this Poster
  buildRouteLayers(currentPoster.route);
  buildCreaturePins(currentPoster.folklore);
  buildDraggableCardMarkers(currentPoster.folklore);
  buildCountryLabels(currentPoster.countryLabels);

  // 5. Update Tour State & Route Geometry
  precalculateRouteDistances();
  currentTourDistance = 0;
  visitedStops.clear();
  currentStopIndex = 0;
  if (currentPoster.folklore && currentPoster.folklore.length > 0) {
    updateTourDockInfo(currentPoster.folklore[0]);
  }
  updateTourPosition();

  // 6. Framing
  if (animate) {
    resetCurrentPosterFraming();
  } else if (currentPoster.bounds) {
    const b = currentPoster.bounds;
    map.fitBounds([
      [b.south, b.west],
      [b.north, b.east]
    ], { padding: [15, 15] });
  }

  // Sound chime
  if (window.hauntedAudio && !window.hauntedAudio.isMuted) {
    window.hauntedAudio.playBell(0.85);
  }
}

// ---------------------------------------------------------
// 2. ROUTE & PIN BUILDERS
// ---------------------------------------------------------
function buildRouteLayers(routeGeo) {
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];
  routeCoords = [];

  if (!routeGeo || !routeGeo.features || routeGeo.features.length === 0) return;
  const rawCoords = routeGeo.features[0].geometry.coordinates;
  routeCoords = rawCoords.map(c => [c[1], c[0]]);

  const isChecked = document.getElementById('toggle-route')?.checked !== false;

  const hazeGlow = L.polyline(routeCoords, {
    color: '#e67e22',
    weight: 22,
    opacity: 0.35,
    className: 'spooky-route-haze',
    lineCap: 'round',
    lineJoin: 'round'
  });

  const outerGlow = L.polyline(routeCoords, {
    color: '#f0f921',
    weight: 11,
    opacity: 0.65,
    className: 'spooky-route-aura',
    lineCap: 'round',
    lineJoin: 'round'
  });

  const spiritStream = L.polyline(routeCoords, {
    color: '#ffffff',
    weight: 3.5,
    opacity: 0.85,
    className: 'spooky-route-spirits',
    lineCap: 'round',
    lineJoin: 'round'
  });

  const innerSpine = L.polyline(routeCoords, {
    color: '#fefeed',
    weight: 2.0,
    opacity: 0.95,
    className: 'spooky-route-core',
    lineCap: 'round',
    lineJoin: 'round'
  });

  routeLayers = [hazeGlow, outerGlow, spiritStream, innerSpine];
  if (isChecked) {
    routeLayers.forEach(l => l.addTo(map));
  }
}

function buildCreaturePins(folkloreList) {
  creatureMarkers.forEach(c => map.removeLayer(c.marker));
  creatureMarkers = [];

  if (!folkloreList) return;

  folkloreList.forEach(item => {
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
}

function buildCountryLabels(labels) {
  countryLabelMarkers.forEach(m => map.removeLayer(m));
  countryLabelMarkers = [];

  if (!labels) return;

  labels.forEach(loc => {
    const icon = L.divIcon({
      className: 'country-label-container',
      html: `<div class="map-country-label">${loc.name}</div>`,
      iconSize: [160, 24],
      iconAnchor: [80, 12]
    });
    const marker = L.marker([loc.lat, loc.lon], { icon, interactive: false }).addTo(map);
    countryLabelMarkers.push(marker);
  });
}

// ---------------------------------------------------------
// 3. DRAGGABLE & MAP-ANCHORED POSTER CARDS
// ---------------------------------------------------------
function buildDraggableCardMarkers(folkloreList) {
  cardMarkersList.forEach(c => {
    map.removeLayer(c.marker);
    if (c.leaderLine) map.removeLayer(c.leaderLine);
  });
  cardMarkersList = [];

  if (!folkloreList) return;

  let savedPositions = {};
  try {
    savedPositions = JSON.parse(localStorage.getItem(`haunted_map_card_positions_${currentEdition}`) || '{}');
  } catch (e) {
    savedPositions = {};
  }

  const isCardsChecked = document.getElementById('toggle-cards')?.checked !== false;
  const isLeadersChecked = document.getElementById('toggle-leaders')?.checked !== false;

  folkloreList.forEach(item => {
    const saved = savedPositions[item.number];
    const initialLat = saved && typeof saved.lat === 'number' ? saved.lat : item.cardLat;
    const initialLon = saved && typeof saved.lon === 'number' ? saved.lon : item.cardLon;

    const leaderLine = L.polyline([[item.lat, item.lon], [initialLat, initialLon]], {
      color: '#f5b041',
      weight: 2.0,
      dashArray: '6, 9',
      opacity: 0.85,
      className: 'card-leader-line',
      interactive: false
    });
    if (isLeadersChecked) leaderLine.addTo(map);

    const descWords = item.description.split(/\s+/).filter(w => w.length > 0);
    const tokenisedDesc = descWords.map((w, idx) => `<span class="lore-word" id="lore-word-${item.number}-${idx}">${w}</span>`).join(' ');

    const cardHtml = `
      <div class="folklore-card" id="card-${item.number}" title="Click to explore lore • Drag anywhere to move">
        <div class="card-title">
          <span>${item.title}</span>
        </div>
        <div class="card-image-box">
          <img src="${item.image}" alt="${item.title}" class="card-img-cryptid card-img-${item.number}" draggable="false" style="width:100% !important; height:100% !important; object-fit:cover !important; display:block !important;">
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
    });
    if (isCardsChecked) cardMarker.addTo(map);

    let dragStarted = false;

    cardMarker.on('dragstart', () => {
      dragStarted = true;
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
      saveCardPosition(item.number, finalPos.lat, finalPos.lng);
      setTimeout(() => { dragStarted = false; }, 100);
    });

    cardMarker.on('mouseover', () => {
      highlightPin(item.number);
      highlightCard(item.number);
      leaderLine.setStyle({ color: '#f0f921', weight: 2.8, opacity: 1.0 });
      if (window.hauntedAudio) window.hauntedAudio.playWhisper();
    });

    cardMarker.on('mouseout', () => {
      if (!dragStarted) {
        const cardEl = document.getElementById(`card-${item.number}`);
        if (cardEl && cardEl.classList.contains('reading-active')) return;
        unhighlightPins();
        unhighlightCards();
        leaderLine.setStyle({ color: '#f5b041', weight: 2.0, opacity: 0.85 });
      }
    });

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
  const key = `haunted_map_card_positions_${currentEdition}`;
  try {
    saved = JSON.parse(localStorage.getItem(key) || '{}');
  } catch (e) {
    saved = {};
  }
  saved[number] = { lat, lon };
  localStorage.setItem(key, JSON.stringify(saved));
}

function resetCardPositions() {
  localStorage.removeItem(`haunted_map_card_positions_${currentEdition}`);
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
// 4. HIGHLIGHT HELPERS & STOP SELECTION
// ---------------------------------------------------------
function highlightPin(number) {
  const pin = document.getElementById(`pin-${number}`);
  if (pin) pin.classList.add('active');
}

function unhighlightPins() {
  document.querySelectorAll('.creature-marker-pin').forEach(p => p.classList.remove('active'));
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
  cardMarkersList.forEach(c => {
    if (c.leaderLine) {
      c.leaderLine.setStyle({ color: '#f0c05a', weight: 1.5, opacity: 0.65 });
    }
  });
}

function selectStop(number, openDrawer = true, shouldSpeak = true) {
  if (!currentPoster || !currentPoster.folklore) return;
  const item = currentPoster.folklore.find(f => f.number === number);
  if (!item) return;

  currentStopIndex = currentPoster.folklore.indexOf(item);
  unhighlightPins();
  unhighlightCards();
  unhighlightLeaders();

  highlightPin(number);
  highlightCard(number);
  highlightLeader(number);

  if (window.hauntedAudio) {
    window.hauntedAudio.playBell(1.0 - (number * 0.04));
  }

  // Smoothly center map on this stop
  map.flyTo([item.lat, item.lon], Math.max(6, map.getZoom()), {
    duration: 1.2,
    easeLinearity: 0.25
  });

  updateTourDockInfo(item);

  if (openDrawer) {
    openGrimoire(item);
  }

  if (shouldSpeak && window.spookyNarrator && window.spookyNarrator.enabled) {
    window.spookyNarrator.readStop(item);
  }
}

// ---------------------------------------------------------
// 5. GRIMOIRE (LORE DRAWER) & LIGHTBOX
// ---------------------------------------------------------
function openGrimoire(item) {
  const drawer = document.getElementById('grimoire-drawer');
  if (!drawer) return;

  document.getElementById('grimoire-title').textContent = item.title;
  document.getElementById('grimoire-location').textContent = `${item.location} • Stop #${item.number}`;
  
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
// 6. FUNCTIONAL MAP NAVIGATION PANEL (MINIMAP, COMPASS, DYNAMIC SCALE)
// ---------------------------------------------------------
let minimapBgCanvas = null;
let minimapCanvas = null;
let minimapCtx = null;
let minimapWorldData = null;
let isDraggingMinimap = false;
let minimapDragOffset = [0, 0];
let currentMinimapRect = null;
let scaleUnit = 'mi'; // 'mi' or 'km'
let minimapRipple = null; // { x, y, radius, maxRadius, alpha }
let minimapAnimFrame = null;

function initMapNavigationPanel(worldGeo) {
  minimapCanvas = document.getElementById('inset-map-canvas');
  if (!minimapCanvas || !worldGeo) return;

  minimapCtx = minimapCanvas.getContext('2d');
  minimapWorldData = worldGeo;

  // Build high-performance pre-rendered background canvas
  renderMinimapBackground();

  // Draw initial viewport state
  drawMinimap();

  // Setup interactive pointer events on minimap (drag, click, hover)
  setupMinimapInteractions();

  // Setup interactive Compass Rose (North reset)
  initCompassRose();

  // Setup dynamic Scale Bar
  initScaleBar();

  // Keep minimap and scale bar in sync with main Leaflet map
  map.on('move', () => {
    drawMinimap();
    updateDynamicScaleBar();
  });
  map.on('zoomend', () => {
    drawMinimap();
    updateDynamicScaleBar();
  });
  map.on('resize', () => {
    renderMinimapBackground();
    drawMinimap();
    updateDynamicScaleBar();
  });

  // Calculate initial scale bar
  setTimeout(updateDynamicScaleBar, 200);
}

function projectMinimap(lon, lat, w, h) {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

function unprojectMinimap(x, y, w, h) {
  const lon = (x / w) * 360 - 180;
  const lat = 90 - (y / h) * 180;
  return [Math.max(-85, Math.min(85, lat)), Math.max(-180, Math.min(180, lon))];
}

function renderMinimapBackground() {
  if (!minimapCanvas || !minimapWorldData) return;

  const rect = minimapCanvas.getBoundingClientRect();
  const dpr = Math.max(2, window.devicePixelRatio || 2);
  const w = minimapCanvas.width = Math.round((rect.width || 180) * dpr);
  const h = minimapCanvas.height = Math.round((rect.height || 110) * dpr);

  minimapBgCanvas = document.createElement('canvas');
  minimapBgCanvas.width = w;
  minimapBgCanvas.height = h;
  const bgCtx = minimapBgCanvas.getContext('2d');

  // Deep dark sea background
  bgCtx.fillStyle = '#17181c';
  bgCtx.fillRect(0, 0, w, h);

  // Subtle minimap graticule grid lines
  bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  bgCtx.lineWidth = 1;
  // Equator
  const [eqX1, eqY] = projectMinimap(-180, 0, w, h);
  const [eqX2] = projectMinimap(180, 0, w, h);
  bgCtx.beginPath();
  bgCtx.moveTo(eqX1, eqY);
  bgCtx.lineTo(eqX2, eqY);
  bgCtx.stroke();
  // Prime Meridian
  const [pmX, pmY1] = projectMinimap(0, 85, w, h);
  const [, pmY2] = projectMinimap(0, -85, w, h);
  bgCtx.beginPath();
  bgCtx.moveTo(pmX, pmY1);
  bgCtx.lineTo(pmX, pmY2);
  bgCtx.stroke();

  // World landmass polygons
  bgCtx.fillStyle = '#343538';
  bgCtx.strokeStyle = '#222326';
  bgCtx.lineWidth = 1;

  minimapWorldData.features.forEach(feat => {
    const geom = feat.geometry;
    if (!geom) return;

    bgCtx.beginPath();
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

    polys.forEach(poly => {
      poly.forEach(ring => {
        ring.forEach((pt, i) => {
          const [px, py] = projectMinimap(pt[0], pt[1], w, h);
          if (i === 0) bgCtx.moveTo(px, py);
          else bgCtx.lineTo(px, py);
        });
      });
    });
    bgCtx.fill();
    bgCtx.stroke();
  });
}

function getMinimapViewportRect(w, h) {
  if (!map) return null;
  const b = map.getBounds();
  const north = Math.min(84, Math.max(-84, b.getNorth()));
  const south = Math.min(84, Math.max(-84, b.getSouth()));
  let west = b.getWest();
  let east = b.getEast();

  if (east - west >= 360) {
    west = -180;
    east = 180;
  } else {
    west = Math.max(-180, Math.min(180, west));
    east = Math.max(-180, Math.min(180, east));
  }

  const [x1, y1] = projectMinimap(west, north, w, h);
  const [x2, y2] = projectMinimap(east, south, w, h);

  const rectW = Math.max(12, Math.abs(x2 - x1));
  const rectH = Math.max(8, Math.abs(y2 - y1));
  const rectX = Math.min(w - rectW, Math.max(0, Math.min(x1, x2)));
  const rectY = Math.min(h - rectH, Math.max(0, Math.min(y1, y2)));

  return { x: rectX, y: rectY, w: rectW, h: rectH };
}

function drawMinimap() {
  if (!minimapCanvas || !minimapCtx || !minimapBgCanvas) return;

  const w = minimapCanvas.width;
  const h = minimapCanvas.height;

  // 1. Draw cached world background
  minimapCtx.clearRect(0, 0, w, h);
  minimapCtx.drawImage(minimapBgCanvas, 0, 0);

  // 2. Compute dynamic viewport rect
  currentMinimapRect = getMinimapViewportRect(w, h);
  if (!currentMinimapRect) return;

  const { x, y, w: rw, h: rh } = currentMinimapRect;

  // Semi-transparent glowing amber fill
  minimapCtx.fillStyle = 'rgba(240, 192, 90, 0.22)';
  minimapCtx.fillRect(x, y, rw, rh);

  // Outer glowing border
  minimapCtx.save();
  minimapCtx.shadowColor = '#f5b041';
  minimapCtx.shadowBlur = 8;
  minimapCtx.strokeStyle = '#f5b041';
  minimapCtx.lineWidth = 2.5;
  minimapCtx.strokeRect(x, y, rw, rh);
  minimapCtx.restore();

  // Corner viewfinder brackets
  const bracketLen = Math.min(rw * 0.28, rh * 0.28, 6);
  if (bracketLen >= 3) {
    minimapCtx.strokeStyle = '#ffeaa7';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    // Top-left
    minimapCtx.moveTo(x, y + bracketLen); minimapCtx.lineTo(x, y); minimapCtx.lineTo(x + bracketLen, y);
    // Top-right
    minimapCtx.moveTo(x + rw - bracketLen, y); minimapCtx.lineTo(x + rw, y); minimapCtx.lineTo(x + rw, y + bracketLen);
    // Bottom-left
    minimapCtx.moveTo(x, y + rh - bracketLen); minimapCtx.lineTo(x, y + rh); minimapCtx.lineTo(x + bracketLen, y + rh);
    // Bottom-right
    minimapCtx.moveTo(x + rw - bracketLen, y + rh); minimapCtx.lineTo(x + rw, y + rh); minimapCtx.lineTo(x + rw, y + rh - bracketLen);
    minimapCtx.stroke();
  }

  // Viewport center reticle / crosshair dot
  minimapCtx.fillStyle = '#ffffff';
  minimapCtx.beginPath();
  minimapCtx.arc(x + rw / 2, y + rh / 2, 2, 0, Math.PI * 2);
  minimapCtx.fill();

  // Active click ripple feedback
  if (minimapRipple) {
    minimapCtx.save();
    minimapCtx.strokeStyle = `rgba(255, 215, 0, ${minimapRipple.alpha})`;
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.arc(minimapRipple.x, minimapRipple.y, minimapRipple.radius, 0, Math.PI * 2);
    minimapCtx.stroke();
    minimapCtx.restore();
  }
}

function triggerMinimapRipple(canvasX, canvasY) {
  minimapRipple = { x: canvasX, y: canvasY, radius: 4, maxRadius: 28, alpha: 0.95 };
  if (minimapAnimFrame) cancelAnimationFrame(minimapAnimFrame);

  function step() {
    if (!minimapRipple) return;
    minimapRipple.radius += 2.2;
    minimapRipple.alpha -= 0.08;
    if (minimapRipple.alpha <= 0 || minimapRipple.radius >= minimapRipple.maxRadius) {
      minimapRipple = null;
      drawMinimap();
      return;
    }
    drawMinimap();
    minimapAnimFrame = requestAnimationFrame(step);
  }
  minimapAnimFrame = requestAnimationFrame(step);
}

function setupMinimapInteractions() {
  const frame = document.getElementById('inset-map-frame');
  if (!minimapCanvas || !frame) return;

  function getCanvasCoords(e) {
    const rect = minimapCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = ((clientX - rect.left) / rect.width) * minimapCanvas.width;
    const y = ((clientY - rect.top) / rect.height) * minimapCanvas.height;
    return [x, y];
  }

  function isInsideRect(x, y, rect) {
    if (!rect) return false;
    const pad = 6;
    return x >= (rect.x - pad) && x <= (rect.x + rect.w + pad) &&
           y >= (rect.y - pad) && y <= (rect.y + rect.h + pad);
  }

  function onPointerDown(e) {
    const [cx, cy] = getCanvasCoords(e);
    const w = minimapCanvas.width;
    const h = minimapCanvas.height;

    if (currentMinimapRect && isInsideRect(cx, cy, currentMinimapRect)) {
      // User grabbed the golden viewport box to drag
      isDraggingMinimap = true;
      minimapDragOffset = [
        cx - (currentMinimapRect.x + currentMinimapRect.w / 2),
        cy - (currentMinimapRect.y + currentMinimapRect.h / 2)
      ];
      frame.classList.add('dragging');
    } else {
      // Clicked anywhere on world minimap: pan to location & ripple
      const [lat, lon] = unprojectMinimap(cx, cy, w, h);
      map.panTo([lat, lon], { animate: true, duration: 0.6 });
      triggerMinimapRipple(cx, cy);
      if (window.hauntedAudio && !window.hauntedAudio.isMuted) {
        window.hauntedAudio.playWhisper();
      }
      isDraggingMinimap = true;
      minimapDragOffset = [0, 0];
      frame.classList.add('dragging');
    }
  }

  function onPointerMove(e) {
    const [cx, cy] = getCanvasCoords(e);
    const w = minimapCanvas.width;
    const h = minimapCanvas.height;

    if (isDraggingMinimap) {
      // Dragging viewport around the world
      const targetX = Math.max(0, Math.min(w, cx - minimapDragOffset[0]));
      const targetY = Math.max(0, Math.min(h, cy - minimapDragOffset[1]));
      const [lat, lon] = unprojectMinimap(targetX, targetY, w, h);
      map.setView([lat, lon], map.getZoom(), { animate: false });
    } else {
      // Hover feedback
      if (currentMinimapRect && isInsideRect(cx, cy, currentMinimapRect)) {
        minimapCanvas.style.cursor = 'grab';
      } else {
        minimapCanvas.style.cursor = 'crosshair';
      }
    }
  }

  function onPointerUp() {
    if (isDraggingMinimap) {
      isDraggingMinimap = false;
      frame.classList.remove('dragging');
      minimapCanvas.style.cursor = 'grab';
    }
  }

  minimapCanvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  minimapCanvas.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);

  // Double click resets to current poster framing
  minimapCanvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (window.hauntedAudio && !window.hauntedAudio.isMuted) {
      window.hauntedAudio.playWhisper();
    }
    resetCurrentPosterFraming();
  });
}

function initCompassRose() {
  const compass = document.getElementById('compass-rose') || document.querySelector('.compass-rose');
  if (!compass) return;

  function handleCompassClick(e) {
    e.preventDefault();
    if (window.hauntedAudio && !window.hauntedAudio.isMuted) {
      window.hauntedAudio.playWhisper();
    }

    // Trigger smooth 360-deg magnetic spin animation
    compass.classList.remove('compass-spinning');
    void compass.offsetWidth; // Force CSS reflow
    compass.classList.add('compass-spinning');

    // Reset current poster map framing
    resetCurrentPosterFraming();
  }

  compass.addEventListener('click', handleCompassClick);
  compass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleCompassClick(e);
    }
  });

  compass.addEventListener('animationend', () => {
    compass.classList.remove('compass-spinning');
  });
}

function initScaleBar() {
  const scalebar = document.getElementById('scalebar-custom') || document.querySelector('.scalebar-custom');
  if (!scalebar) return;

  function toggleUnits() {
    scaleUnit = scaleUnit === 'mi' ? 'km' : 'mi';
    updateDynamicScaleBar();
    if (window.hauntedAudio && !window.hauntedAudio.isMuted) {
      window.hauntedAudio.playWhisper();
    }
    scalebar.setAttribute('title', `Scale: Showing ${scaleUnit === 'mi' ? 'Miles (mi)' : 'Kilometers (km)'} • Click to toggle`);
  }

  scalebar.addEventListener('click', toggleUnits);
  scalebar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleUnits();
    }
  });

  updateDynamicScaleBar();
}

function updateDynamicScaleBar() {
  if (!map) return;
  const center = map.getCenter();
  const p1 = map.latLngToContainerPoint(center);
  const p2 = L.point(p1.x + 100, p1.y);
  const latLng2 = map.containerPointToLatLng(p2);
  const metersPer100px = center.distanceTo(latLng2);
  if (!metersPer100px || metersPer100px <= 0) return;

  const metersPerPx = metersPer100px / 100;
  const isMiles = scaleUnit === 'mi';

  // Standard step intervals for clean cartographic display
  const standardSteps = [
    0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000
  ];

  let bestStep = standardSteps[0];
  let bestPxDiff = Infinity;

  for (const step of standardSteps) {
    const px = isMiles ? (step / (metersPerPx * 0.000621371)) : (step * 1000 / metersPerPx);
    if (px >= 60 && px <= 140) {
      const diff = Math.abs(px - 100);
      if (diff < bestPxDiff) {
        bestPxDiff = diff;
        bestStep = step;
      }
    }
  }

  const finalPxWidth = Math.round(isMiles ? (bestStep / (metersPerPx * 0.000621371)) : (bestStep * 1000 / metersPerPx));

  const scalebarLine = document.querySelector('.scalebar-line');
  const scalebarTicks = document.querySelector('.scalebar-ticks');
  const tick0 = document.getElementById('scale-tick-0');
  const tickMid = document.getElementById('scale-tick-mid');
  const tickEnd = document.getElementById('scale-tick-end');

  if (scalebarLine && scalebarTicks) {
    scalebarLine.style.width = `${finalPxWidth}px`;
    scalebarTicks.style.width = `${finalPxWidth}px`;

    const halfStep = Number.isInteger(bestStep) ? (bestStep % 2 === 0 ? bestStep / 2 : (bestStep / 2).toFixed(1)) : (bestStep / 2).toFixed(1);
    const unitLabel = isMiles ? 'mi' : 'km';

    if (tick0) tick0.textContent = '0';
    if (tickMid) tickMid.textContent = `${halfStep}`;
    if (tickEnd) tickEnd.textContent = `${bestStep} ${unitLabel}`;
  }
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

  // Precalculate closest distance along the route for each of the folklore stops
  const folklore = (currentPoster && currentPoster.folklore) ? currentPoster.folklore : (window.HAUNTED_DATA.folklore || []);
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
      distance: routeDistances[bestIdx] || 0
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
    if (tourActive) {
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
  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      const isEnabled = window.spookyNarrator.toggleEnabled();
      if (isEnabled) {
        voiceBtn.classList.add('active');
        voiceBtn.classList.remove('muted');
        voiceBtn.title = 'Toggle Spooky Voice (Currently: ON)';
      } else {
        voiceBtn.classList.remove('active');
        voiceBtn.classList.add('muted');
        voiceBtn.title = 'Toggle Spooky Voice (Currently: OFF)';
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
      tourPausedForSpeech = false;
      window.spookyNarrator.stop();
    });
  }

  progressContainer.addEventListener('click', (e) => {
    if (window.spookyNarrator) window.spookyNarrator.stop();
    tourPausedForSpeech = false;
    const rect = progressContainer.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    currentTourDistance = ratio * totalRouteDistance;
    updateTourPosition();
  });

  // Initialize marker at start
  updateTourPosition();
}

let tourPausedForSpeech = false;

function startTour() {
  tourActive = true;
  tourPausedForSpeech = false;
  document.getElementById('tour-play-btn').innerHTML = '❚❚';
  if (window.hauntedAudio && window.hauntedAudio.isMuted) {
    window.hauntedAudio.toggleSound();
  }

  // If already at end, wrap to start
  if (currentTourDistance >= totalRouteDistance - 1000) {
    currentTourDistance = 0;
    visitedStops.clear();
  }

  lastFrameTimestamp = performance.now();

  function tick(timestamp) {
    if (!tourActive) return;

    const dt = Math.min((timestamp - lastFrameTimestamp) / 1000, 0.1);
    lastFrameTimestamp = timestamp;

    currentTourDistance += tourSpeedMps * dt;

    if (currentTourDistance >= totalRouteDistance) {
      currentTourDistance = totalRouteDistance;
      updateTourPosition();
      pauseTour(true);
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
  document.getElementById('tour-play-btn').innerHTML = '▶';
  if (tourTimer) cancelAnimationFrame(tourTimer);
  lastFrameTimestamp = null;
  if (userInitiated) {
    tourPausedForSpeech = false;
    if (window.spookyNarrator) {
      window.spookyNarrator.stop();
    }
  }
}

function updateTourPosition() {
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
  if (isExplorer) {
    map.panTo([pt.lat, pt.lon], { animate: true, duration: 0.15 });
  }
}

function checkStopArrival() {
  if (!stopDistances || stopDistances.length === 0) return;
  const tolerance = Math.max(30000, totalRouteDistance * 0.015);

  // If user scrubbed backwards, clear visited stops ahead of current position
  for (let i = 0; i < stopDistances.length; i++) {
    if (stopDistances[i].distance > currentTourDistance + tolerance * 1.5) {
      visitedStops.delete(stopDistances[i].stop.number);
    }
  }

  for (let i = 0; i < stopDistances.length; i++) {
    const sd = stopDistances[i];
    const diff = Math.abs(currentTourDistance - sd.distance);
    // If within route tolerance of the stop
    if (diff < tolerance && !visitedStops.has(sd.stop.number)) {
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
        window.hauntedAudio.playBell(1.0 - (sd.stop.number * 0.04));
      }

      // Check if Spooky Voice narration is active
      if (window.spookyNarrator && window.spookyNarrator.enabled) {
        const wasAutoTouring = tourActive;
        if (wasAutoTouring) {
          tourPausedForSpeech = true;
          pauseTour(false /* paused for speech, keep speech alive */);
        }

        window.spookyNarrator.readStop(sd.stop, () => {
          if (tourPausedForSpeech) {
            tourPausedForSpeech = false;
            // Short eerie pause before continuing along the road
            setTimeout(() => {
              if (!tourActive && !tourPausedForSpeech) {
                startTour();
              }
            }, 800);
          }
        });
      }
      break;
    }
  }
}

function stepTour(direction) {
  if (window.spookyNarrator) window.spookyNarrator.stop();
  tourPausedForSpeech = false;

  currentStopIndex += direction;
  if (currentStopIndex < 0) currentStopIndex = stopDistances.length - 1;
  if (currentStopIndex >= stopDistances.length) currentStopIndex = 0;

  const target = stopDistances[currentStopIndex];
  if (target) {
    currentTourDistance = target.distance;
    updateTourPosition();
    visitedStops.add(target.stop.number);
    selectStop(target.stop.number, false, true);
    updateTourDockInfo(target.stop);
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
    document.body.classList.remove('mode-explorer');
    document.body.classList.add('mode-poster');
    posterOverlay.style.display = 'block';
    layerPanel.classList.remove('visible');
    resetCurrentPosterFraming();
  });

  explorerBtn.addEventListener('click', () => {
    explorerBtn.classList.add('active');
    posterBtn.classList.remove('active');
    document.body.classList.remove('mode-poster');
    document.body.classList.add('mode-explorer');
    posterOverlay.style.display = 'block';
    layerPanel.classList.add('visible');
  });

  // Poster Edition switching
  document.querySelectorAll('.edition-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const ed = btn.getAttribute('data-edition');
      if (ed) switchEdition(ed, true);
    });
  });

  const editionSelect = document.getElementById('edition-select');
  if (editionSelect) {
    editionSelect.addEventListener('change', (e) => {
      switchEdition(e.target.value, true);
    });
  }

  // Audio Toggle
  const audioBtn = document.getElementById('audio-toggle-btn');
  audioBtn.addEventListener('click', () => {
    if (window.hauntedAudio) {
      const isSounding = window.hauntedAudio.toggleSound();
      audioBtn.classList.toggle('active', isSounding);
      audioBtn.innerHTML = isSounding ? '🔔 Audio: On' : '🔕 Audio: Off';
    }
  });

  // Reset Cards Button
  document.getElementById('reset-cards-btn').addEventListener('click', () => {
    resetCardPositions();
  });

  // Reset Framing Button
  document.getElementById('reset-view-btn').addEventListener('click', () => {
    resetCurrentPosterFraming();
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
}
