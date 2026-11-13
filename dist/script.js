const experience = document.querySelector('.experience');
const tabs = [...document.querySelectorAll('.demo-tab')];
const lightSwitch = document.querySelector('.light-switch');
const wildlifeLayer = document.querySelector('.wildlife-layer');
const glowPhone = document.querySelector('.glow-phone');
const migrationPhone = document.querySelector('.migration-phone');
let conditionsLight = 'night';

function selectDemo(index, moveFocus = false) {
  if (index < 0 || index >= tabs.length) return;
  const conditions = index === 1;
  const wildlife = index === 3;
  if (!wildlife && currentCall) { currentCall.pause(); currentCall.currentTime = 0; }
  experience.dataset.demo = String(index);
  experience.dataset.light = conditions ? conditionsLight : 'night';
  lightSwitch.setAttribute('aria-hidden', String(!conditions));
  lightSwitch.disabled = !conditions;
  wildlifeLayer.inert = !wildlife;
  glowPhone.inert = !wildlife;
  migrationPhone.inert = index !== 4;
  if (index === 4) { renderMigrationMap(); startMigration(); }
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

const sightings = document.querySelector('.app-sightings');
const sightingCount = document.querySelector('.app-count');
const animalDetails = {
  coyote: { name: 'Coyote', image: 'assets/wildlife-coyote.png', call: 'assets/call-coyote-field.wav' },
  owl: { name: 'Great horned owl', image: 'assets/wildlife-great-horned-owl.png', call: 'assets/call-owl-field.wav' },
  frog: { name: 'Sierran tree frog', image: 'assets/wildlife-sierran-tree-frog.png', call: 'assets/call-frog-field.wav' },
  raccoon: { name: 'Raccoon', image: 'assets/wildlife-raccoon.png', call: 'assets/call-raccoon-field.wav' }
};
let sightingNumber = 0;
let currentCall = null;

function recordSighting(key, button) {
  const animal = animalDetails[key];
  if (!animal || experience.dataset.demo !== '3') return;
  if (currentCall) { currentCall.pause(); currentCall.currentTime = 0; }
  currentCall = new Audio(animal.call);
  currentCall.volume = .8;
  currentCall.play().catch(() => {});

  sightingNumber += 1;
  const minuteOfDay = 20 * 60 + 14 + sightingNumber * 2;
  const hours = Math.floor(minuteOfDay / 60) % 24;
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  const displayTime = `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
  sightings.querySelector('.app-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'sighting-row';
  row.innerHTML = `<span class="sighting-image"><img src="${animal.image}" alt=""></span><span class="sighting-info"><span class="sighting-name">${animal.name}</span><time class="sighting-time">${displayTime}</time></span><span class="sighting-check" aria-hidden="true">✓</span>`;
  sightings.append(row);
  row.scrollIntoView({ block: 'nearest' });
  sightingCount.textContent = String(sightingNumber).padStart(2, '0');
  sightingCount.setAttribute('aria-label', `${sightingNumber} sightings`);
  button.classList.remove('is-calling');
  void button.offsetWidth;
  button.classList.add('is-calling');
  setTimeout(() => button.classList.remove('is-calling'), 750);
}

wildlifeLayer.querySelectorAll('[data-animal]').forEach(button => {
  button.addEventListener('click', () => recordSighting(button.dataset.animal, button));
});

const migrationMap = document.querySelector('.migration-map');
const migrationTileLayer = document.querySelector('.migration-tile-layer');
const migrationFlock = document.querySelector('.migration-flock');
const migrationOutput = document.querySelector('.migration-output');
const mapCenter = { lat: 37.385833, lon: -122.016667, zoom: 10 };
const flockPosition = { x: .01, y: .045 };
const lampLocation = { x: .5, y: .5 };
let migrationFrame = 0;

function renderMigrationMap() {
  const width = migrationMap.clientWidth;
  const height = migrationMap.clientHeight;
  if (!width || !height) return;
  const scale = 256 * 2 ** mapCenter.zoom;
  const latitude = mapCenter.lat * Math.PI / 180;
  const centerX = (mapCenter.lon + 180) / 360 * scale;
  const centerY = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * scale;
  const minX = Math.floor((centerX - width / 2) / 256);
  const maxX = Math.floor((centerX + width / 2) / 256);
  const minY = Math.floor((centerY - height / 2) / 256);
  const maxY = Math.floor((centerY + height / 2) / 256);
  const tiles = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.decoding = 'async';
    tile.src = `https://tile.openstreetmap.org/${mapCenter.zoom}/${x}/${y}.png`;
    tile.style.left = `${x * 256 - centerX + width / 2}px`;
    tile.style.top = `${y * 256 - centerY + height / 2}px`;
    tiles.push(tile);
  }
  migrationTileLayer.replaceChildren(...tiles);
}

function updateFlock(x, y) {
  flockPosition.x = x;
  flockPosition.y = y;
  migrationFlock.style.left = `${flockPosition.x * 100}%`;
  migrationFlock.style.top = `${flockPosition.y * 100}%`;
  const bounds = migrationMap.getBoundingClientRect();
  const distance = Math.hypot((flockPosition.x - lampLocation.x) * bounds.width, (flockPosition.y - lampLocation.y) * bounds.height);
  const reach = Math.min(bounds.width * .36, 100);
  const t = Math.max(0, Math.min(1, distance / Math.max(reach, 1)));
  const intensity = .18 + .82 * (t * t * (3 - 2 * t));
  migrationOutput.value = `${Math.round(intensity * 100)}%`;
  const next = intensity.toFixed(3);
  if (experience.dataset.migrationIntensity !== next) {
    experience.dataset.migrationIntensity = next;
    window.dispatchEvent(new Event('bioglow:migration'));
  }
}

function stopMigration() {
  cancelAnimationFrame(migrationFrame);
  migrationFrame = 0;
}

function startMigration() {
  stopMigration();
  const duration = 12000;
  const start = performance.now() - duration * .15;
  let lastUpdate = -Infinity;
  function step(now) {
    if (experience.dataset.demo !== '4') return;
    if (now - lastUpdate >= 30) {
      const progress = ((now - start) % duration) / duration;
      updateFlock(-.20 + 1.4 * progress, -.15 + 1.3 * progress);
      lastUpdate = now;
    }
    migrationFrame = requestAnimationFrame(step);
  }
  step(performance.now());
}
window.addEventListener('resize', () => {
  if (experience.dataset.demo === '4') renderMigrationMap();
  updateFlock(flockPosition.x, flockPosition.y);
});
updateFlock(flockPosition.x, flockPosition.y);
