const experience = document.querySelector('.experience');
const tabs = [...document.querySelectorAll('.demo-tab')];
const lightSwitch = document.querySelector('.light-switch');
const wildlifeLayer = document.querySelector('.wildlife-layer');
const wildlifeInstruction = document.querySelector('.wildlife-instruction');
const glowPhone = document.querySelector('.glow-phone');
const migrationCard = document.querySelector('.migration-card');
const sensorOverlay = document.querySelector('.sensor-overlay');
let conditionsLight = 'night';
let wildlifePoll = 0;
let glowLightPoll = 0;
const directionControlStatus = document.querySelector('[data-direction-control-status]');
const glowLightLive = document.querySelector('[data-light-live]');
const glowLightPower = document.querySelector('[data-light-power]');
const glowLightColor = document.querySelector('[data-light-color]');
const glowLightSwatch = document.querySelector('[data-light-swatch]');
let directionAimOwned = false;
let directionRestoreMode = null;
let directionMaxBeamWidth = 49;
let directionPending = null;
let directionSendTimer = 0;
let directionSending = false;
let directionInFlight = Promise.resolve();
let directionLastSentAt = 0;

async function refreshGlowLight() {
  try {
    const response = await fetch('/api/bioglow/light', {cache:'no-store'});
    const light = await response.json();
    if (!response.ok || light.status !== 'ok') throw new Error('Station unavailable');
    glowLightLive.textContent = 'LIVE';
    glowLightLive.dataset.state = 'connected';
    glowLightPower.textContent = light.on === true ? 'ON' : light.on === false ? 'OFF' : 'Power unknown';
    glowLightPower.dataset.power = light.on === true ? 'on' : light.on === false ? 'off' : 'unknown';
    const color = typeof light.color === 'string' && /^#[0-9a-f]{6}$/i.test(light.color) ? light.color : null;
    glowLightColor.textContent = color ? color.toUpperCase() : 'No color reading';
    glowLightSwatch.style.backgroundColor = color || 'transparent';
    glowLightSwatch.dataset.available = String(Boolean(color));
    window.dispatchEvent(new CustomEvent('bioglow:light-state', {detail:{color,on:light.on,brightness:light.brightness}}));
  } catch {
    glowLightLive.textContent = 'OFFLINE';
    glowLightLive.dataset.state = 'offline';
    glowLightPower.textContent = 'Station unavailable';
    glowLightPower.dataset.power = 'unknown';
    glowLightColor.textContent = '—';
    glowLightSwatch.style.backgroundColor = 'transparent';
    glowLightSwatch.dataset.available = 'false';
    window.dispatchEvent(new CustomEvent('bioglow:light-state', {detail:{color:null,on:null,brightness:null}}));
  }
}

function startGlowLight() {
  stopGlowLight();
  refreshGlowLight();
  glowLightPoll = setInterval(refreshGlowLight, 4000);
}

function stopGlowLight() {
  clearInterval(glowLightPoll);
  glowLightPoll = 0;
}

function showDirectionStatus(message, state = 'connected') {
  directionControlStatus.textContent = message;
  directionControlStatus.dataset.state = state;
}

async function readDirectionState() {
  try {
    const response = await fetch('/api/bioglow/direction', { cache:'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'The station direction service is unavailable.');
    if (Number.isInteger(result.max_beam_width)) directionMaxBeamWidth = result.max_beam_width;
    showDirectionStatus(result.mode === 'manual_control'
      ? 'The station is in manual control. Switch modes on the Pi before steering it here.'
      : `Move the person to steer the station lamp. Current beam width: ${result.beam_width ?? '—'} pixels.`, result.mode === 'manual_control' ? 'offline' : 'connected');
  } catch (error) {
    showDirectionStatus(error.message || 'Could not connect to the station lamp.', 'offline');
  }
}

async function postDirectionControl(payload) {
  const response = await fetch('/api/bioglow/direction', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.error?.message || 'The station could not aim the lamp.');
  return result;
}

async function flushDirectionAngle() {
  if (directionSending || directionPending === null) return;
  const {angle, beam_width} = directionPending;
  directionPending = null;
  directionSending = true;
  directionLastSentAt = Date.now();
  directionInFlight = (async () => {
    const result = await postDirectionControl({angle,beam_width});
    if (result.started) {
      directionAimOwned = true;
      directionRestoreMode = result.original_mode || 'normal';
    }
    if (Number.isInteger(result.max_beam_width)) directionMaxBeamWidth = result.max_beam_width;
    showDirectionStatus(`Station beam · ${result.angle_degrees ?? angle}° · ${result.beam_width ?? beam_width} pixels wide.`, 'connected');
  })();
  try {
    await directionInFlight;
  } catch (error) {
    showDirectionStatus(error.message || 'Could not update the station lamp.', 'offline');
  } finally {
    directionSending = false;
    if (directionPending !== null) setTimeout(flushDirectionAngle, 0);
  }
}

function queueDirectionAngle(angle, distance, settled) {
  if (experience.dataset.demo !== '2') return;
  const progress = Math.max(0, Math.min(1, (distance - 34) / 220));
  const widthSteps = Math.floor((directionMaxBeamWidth - 1) / 2);
  const beam_width = 1 + 2 * Math.round(progress * widthSteps);
  directionPending = {angle, beam_width};
  clearTimeout(directionSendTimer);
  const updateInterval = 90;
  const delay = settled ? 0 : Math.max(0, updateInterval - (Date.now() - directionLastSentAt));
  directionSendTimer = setTimeout(flushDirectionAngle, delay);
}

async function stopDirectionControl() {
  clearTimeout(directionSendTimer);
  directionPending = null;
  if (directionSending) await directionInFlight.catch(() => {});
  if (!directionAimOwned) return;
  directionAimOwned = false;
  const restoreMode = directionRestoreMode;
  directionRestoreMode = null;
  try {
    await postDirectionControl({action:'stop',restore_mode:restoreMode});
  } catch (error) {
    showDirectionStatus(error.message || 'Could not return the station to its previous mode.', 'offline');
  }
}

window.addEventListener('bioglow:person-moved', event => {
  queueDirectionAngle(event.detail.angle, event.detail.distance, event.detail.settled);
});

function selectDemo(index, moveFocus = false) {
  if (index < 0 || index >= tabs.length) return;
  const previousDemo = Number(experience.dataset.demo);
  const conditions = index === 1;
  const wildlife = index === 3;
  if (!wildlife && currentCall) { currentCall.pause(); currentCall.currentTime = 0; }
  experience.dataset.demo = String(index);
  experience.dataset.light = conditions ? conditionsLight : 'night';
  if (index === 0) startGlowLight();
  else stopGlowLight();
  if (index === 2) readDirectionState();
  else if (previousDemo === 2) stopDirectionControl();
  lightSwitch.setAttribute('aria-hidden', String(!conditions));
  lightSwitch.disabled = !conditions;
  wildlifeLayer.inert = !wildlife;
  glowPhone.inert = !wildlife;
  migrationCard.inert = index !== 4;
  sensorOverlay.inert = index !== 5;
  if (index === 3) startWildlife();
  else stopWildlife();
  if (index === 4) startMigration();
  else stopMigration();
  tabs.forEach((tab, tabIndex) => {
    const selected = tabIndex === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  if (moveFocus) tabs[index].focus();
}

function setLight(light) {
  if (light !== 'day' && light !== 'night') return;
  conditionsLight = light;
  lightSwitch.dataset.light = light;
  lightSwitch.setAttribute('aria-checked', String(light === 'night'));
  if (experience.dataset.demo === '1') experience.dataset.light = light;
}

lightSwitch.addEventListener('click', () => setLight(conditionsLight === 'night' ? 'day' : 'night'));

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectDemo(index));
  tab.addEventListener('keydown', event => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectDemo(next, true);
  });
});

startGlowLight();

const wildlifeSightings = document.querySelector('.app-sightings');
const wildlifeCount = document.querySelector('.app-count');
const wildlifeStatus = document.querySelector('[data-wildlife-api-state]');
const wildlifeDashboard = document.querySelector('.wildlife-dashboard');
const wildlifeCollapseToggle = document.querySelector('.wildlife-collapse-toggle');
const animalDetails = {
  coyote: { call: 'assets/call-coyote-field.wav' },
  owl: { call: 'assets/call-owl-field.wav' },
  frog: { call: 'assets/call-frog-field.wav' },
  raccoon: { call: 'assets/call-raccoon-field.wav' }
};
let animalTapCount = 0;
let currentCall = null;
let wildlifeImageObserver = null;

wildlifeCollapseToggle.addEventListener('click', () => {
  const collapsed = wildlifeDashboard.classList.toggle('wildlife-collapsed');
  wildlifeCollapseToggle.setAttribute('aria-expanded', String(!collapsed));
  wildlifeCollapseToggle.innerHTML = collapsed ? 'Expand <span aria-hidden="true">⌄</span>' : 'Collapse <span aria-hidden="true">⌃</span>';
});

function recordSighting(key, button) {
  const animal = animalDetails[key];
  if (!animal || experience.dataset.demo !== '3') return;
  if (currentCall) { currentCall.pause(); currentCall.currentTime = 0; }
  currentCall = new Audio(animal.call);
  currentCall.volume = .8;
  currentCall.play().catch(() => {});

  animalTapCount += 1;
  if (animalTapCount === 2) {
    experience.classList.add('wildlife-instruction-dismissed');
    wildlifeInstruction.setAttribute('aria-hidden', 'true');
  }
  button.classList.remove('is-calling');
  void button.offsetWidth;
  button.classList.add('is-calling');
  setTimeout(() => button.classList.remove('is-calling'), 750);
}

wildlifeLayer.querySelectorAll('[data-animal]').forEach(button => {
  button.addEventListener('click', () => recordSighting(button.dataset.animal, button));
});

function clearWildlifeCards(message) {
  wildlifeImageObserver?.disconnect();
  wildlifeImageObserver = null;
  const empty = document.createElement('div');
  empty.className = 'app-empty';
  const icon = document.createElement('span');
  icon.className = 'app-empty-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✳';
  const text = document.createElement('span');
  text.textContent = message;
  empty.append(icon, text);
  wildlifeSightings.replaceChildren(empty);
}

function formatDetectionTime(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

async function loadWildlifeCommonName(name) {
  if (name.dataset.loading === 'true') return;
  name.dataset.loading = 'true';
  try {
    const response = await fetch(`/api/wildlife/name?species=${encodeURIComponent(name.dataset.species)}`, { cache:'force-cache' });
    if (!response.ok) throw new Error('No common name');
    const result = await response.json();
    if (result.common_name) name.textContent = result.common_name;
  } catch {
    name.textContent = name.dataset.species;
  }
}

async function loadWildlifeImage(image) {
  if (image.dataset.loading === 'true') return;
  image.dataset.loading = 'true';
  try {
    const response = await fetch(`/api/wildlife/image?species=${encodeURIComponent(image.dataset.species)}`, { cache:'force-cache' });
    if (!response.ok) throw new Error('No reference photo');
    const photo = await response.json();
    const card = image.closest('.sighting-row');
    const name = card?.querySelector('.sighting-name');
    const credit = card?.querySelector('.sighting-credit');
    if (name && photo.common_name) name.textContent = photo.common_name;
    if (photo.image_url) {
      image.src = photo.image_url;
      image.alt = photo.common_name || image.dataset.species;
    } else {
      image.parentElement?.classList.add('sighting-image-empty');
      image.remove();
    }
    if (credit) {
      credit.textContent = photo.image_attribution ? `Photo via iNaturalist · ${photo.image_attribution}` : 'Photo via iNaturalist';
      if (photo.taxon_url) credit.href = photo.taxon_url;
    }
  } catch {
    image.parentElement?.classList.add('sighting-image-empty');
    image.remove();
  }
}

function renderWildlifeCards(payload) {
  const animals = Array.isArray(payload.animals) ? payload.animals : [];
  wildlifeStatus.textContent = payload.status === 'ok' ? 'LIVE' : 'OFFLINE';
  wildlifeStatus.setAttribute('data-state', payload.status === 'ok' ? 'connected' : 'offline');
  wildlifeCount.textContent = String(payload.recordings_analyzed || 0).padStart(2, '0');
  wildlifeCount.setAttribute('aria-label', `${payload.recordings_analyzed || 0} model detections in the last hour`);
  if (!animals.length) {
    clearWildlifeCards(payload.status === 'ok' ? 'No completed animal analyses in the last hour.' : 'Station animal history is unavailable.');
    return;
  }

  const cards = animals.map(animal => {
    const card = document.createElement('article');
    card.className = 'sighting-row';
    const photo = document.createElement('div');
    photo.className = 'sighting-image';
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.dataset.species = animal.scientific_name;
    photo.append(image);
    const info = document.createElement('div');
    info.className = 'sighting-info';
    const heading = document.createElement('div');
    heading.className = 'sighting-heading';
    const name = document.createElement('span');
    name.className = 'sighting-name';
    name.textContent = animal.common_name || 'Loading common name…';
    name.dataset.species = animal.scientific_name;
    const count = document.createElement('span');
    count.className = 'sighting-count';
    count.textContent = `${animal.detection_count} ${animal.detection_count === 1 ? 'detection' : 'detections'}`;
    heading.append(name, count);
    const scientificName = document.createElement('span');
    scientificName.className = 'sighting-scientific';
    scientificName.textContent = animal.scientific_name;
    const detectedAt = document.createElement('time');
    detectedAt.className = 'sighting-time';
    detectedAt.dateTime = animal.last_detected || '';
    detectedAt.textContent = `Latest · ${formatDetectionTime(animal.last_detected)}`;
    info.append(heading, scientificName, detectedAt);
    if (animal.image_attribution) {
      const credit = document.createElement('span');
      credit.className = 'sighting-credit';
      credit.textContent = animal.image_attribution;
      info.append(credit);
    } else {
      const credit = document.createElement('a');
      credit.className = 'sighting-credit';
      credit.href = 'https://www.inaturalist.org/';
      credit.target = '_blank';
      credit.rel = 'noopener';
      credit.textContent = 'Photo via iNaturalist';
      info.append(credit);
    }
    card.append(photo, info);
    return card;
  });
  wildlifeSightings.replaceChildren(...cards);
  wildlifeSightings.querySelectorAll('.sighting-name[data-species]').forEach(loadWildlifeCommonName);
  wildlifeImageObserver?.disconnect();
  if ('IntersectionObserver' in window) {
    wildlifeImageObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          wildlifeImageObserver.unobserve(entry.target);
          loadWildlifeImage(entry.target);
        }
      });
    }, { root:wildlifeSightings, rootMargin:'100px' });
    wildlifeSightings.querySelectorAll('img[data-species]').forEach(image => wildlifeImageObserver.observe(image));
  } else {
    wildlifeSightings.querySelectorAll('img[data-species]').forEach(loadWildlifeImage);
  }
}

async function refreshWildlifeCards() {
  try {
    const response = await fetch('/api/wildlife/detections', { cache:'no-store' });
    if (!response.ok) throw new Error(`Wildlife API returned ${response.status}`);
    renderWildlifeCards(await response.json());
  } catch {
    wildlifeStatus.textContent = 'OFFLINE';
    wildlifeStatus.setAttribute('data-state', 'offline');
    clearWildlifeCards('Unable to load station detections.');
  }
}

function stopWildlife() {
  clearInterval(wildlifePoll);
  wildlifePoll = 0;
}

function startWildlife() {
  stopWildlife();
  refreshWildlifeCards();
  wildlifePoll = setInterval(() => {
    if (experience.dataset.demo === '3') refreshWildlifeCards();
  }, 30000);
}

const migrationNodes = Object.fromEntries([
  'api-state','bird-region','birdcast-meta','birds-in-flight','birds-crossed','migration-level',
  'migration-direction','migration-speed','migration-altitude','migration-note','migration-updated','birdcast-source'
].map(name => [name, document.querySelector(`[data-${name}]`)]));
let migrationPoll = 0;

function setMigrationText(name, value) {
  const node = migrationNodes[name];
  if (node) node.textContent = value;
}

function apiDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

function renderMigrationDashboard(payload) {
  const latest = payload.latest?.data;
  if (!latest) throw new Error('Latest station data is unavailable');
  const source = latest.sources?.birdcast;
  const birdcast = source?.http_status === 200 && source.result?.status !== 'error' ? source.result : source?.last_success;
  if (!birdcast) throw new Error('BirdCast migration data is unavailable');
  const metrics = birdcast.metrics || {};

  setMigrationText('bird-region', birdcast.region?.name || 'REGIONAL FEED');
  setMigrationText('birds-in-flight', Number.isFinite(metrics.birds_in_flight) ? metrics.birds_in_flight.toLocaleString() : 'Unavailable');
  setMigrationText('birds-crossed', Number.isFinite(metrics.total_birds_crossed) ? metrics.total_birds_crossed.toLocaleString() : 'Unavailable');
  setMigrationText('migration-level', String(birdcast.migration_level || 'unknown').replaceAll('_', ' '));
  setMigrationText('migration-direction', metrics.direction || 'Unavailable');
  setMigrationText('migration-speed', Number.isFinite(metrics.speed_mph) ? `${metrics.speed_mph} mph` : 'Unavailable');
  setMigrationText('migration-altitude', Number.isFinite(metrics.altitude_ft) ? `${metrics.altitude_ft.toLocaleString()} ft` : 'Unavailable');
  setMigrationText('birdcast-meta', `${birdcast.live_feed ? 'Live feed' : 'Cached BirdCast'}${birdcast.selected_night ? ` · ${birdcast.selected_night}` : ''}`);
  setMigrationText('migration-updated', `Retrieved ${apiDate(birdcast.retrieved_at) || 'time unavailable'}`);
  const warning = Array.isArray(birdcast.warnings) ? birdcast.warnings.find(item => /direction|speed|altitude|unavailable|unreliable/i.test(item)) : '';
  setMigrationText('migration-note', warning || (birdcast.live_feed ? 'BirdCast data is live.' : 'Cached regional data; BirdCast does not report a live flock position.'));
  const sourceLink = migrationNodes['birdcast-source'];
  try {
    const url = new URL(birdcast.source?.url || 'https://dashboard.birdcast.org/region/US-CA');
    sourceLink.href = url.origin === 'https://dashboard.birdcast.org' ? url.href : 'https://dashboard.birdcast.org/region/US-CA';
  } catch {
    sourceLink.href = 'https://dashboard.birdcast.org/region/US-CA';
  }
  setMigrationText('api-state', payload.latest.http_status === 200 ? 'CONNECTED' : 'CACHED');
}

async function refreshMigrationDashboard() {
  try {
    const response = await fetch('/api/bioglow/dashboard', { cache:'no-store' });
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    renderMigrationDashboard(await response.json());
  } catch (error) {
    setMigrationText('api-state', 'OFFLINE');
    setMigrationText('migration-updated', error.message || 'Unable to load BirdCast migration data.');
  }
}

function stopMigration() {
  clearInterval(migrationPoll);
  migrationPoll = 0;
}

function startMigration() {
  stopMigration();
  refreshMigrationDashboard();
  migrationPoll = setInterval(() => {
    if (experience.dataset.demo === '4') refreshMigrationDashboard();
  }, 30000);
}
