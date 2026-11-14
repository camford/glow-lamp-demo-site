import {fetchStationJson, jsonResponse} from './bioglow.js';

const INATURALIST_OBSERVATIONS = 'https://api.inaturalist.org/v1/observations';
const INATURALIST_TAXA = 'https://api.inaturalist.org/v1/taxa';
const VALID_SPECIES = /^[A-Za-z][A-Za-z .'-]{1,90}$/;
const ALLOWED_IMAGE_HOSTS = new Set(['static.inaturalist.org','inaturalist-open-data.s3.amazonaws.com']);
const WILDLIFE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getWildlifeDetections(env) {
  const response = await fetchStationJson(env,'history');
  const data = response.data && typeof response.data === 'object' ? response.data : {};
  const counts = new Map();
  const seen = new Set();
  const cutoff = Date.now() - WILDLIFE_WINDOW_MS;
  for (const entry of Array.isArray(data.entries)?data.entries:[]) {
    const result = entry?.result && typeof entry.result === 'object' ? entry.result : {};
    const predictions = Array.isArray(result.animals)?result.animals:[];
    if (entry?.http_status !== 200 || result.state !== 'completed' || predictions.length === 0) continue;
    const id = result.recording_id || result.timestamp;
    const key = id == null ? 'missing-recording-id' : String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    const timestamp = result.timestamp || entry.read_at || '';
    const detectedAt = typeof timestamp === 'number'
      ? (timestamp < 1e12 ? timestamp * 1000 : timestamp)
      : Date.parse(timestamp);
    if (!Number.isFinite(detectedAt) || detectedAt < cutoff) continue;
    const top = predictions.reduce((best,item) => Number(item?.score) > Number(best?.score) ? item : best, predictions[0]);
    const name = top?.scientific_name;
    if (typeof name !== 'string' || !VALID_SPECIES.test(name)) continue;
    const item = counts.get(name) || {count:0,last_detected:''};
    item.count += 1;
    if (String(timestamp) > item.last_detected) item.last_detected = String(timestamp);
    counts.set(name,item);
  }

  const animals = [...counts.entries()]
    .sort(([nameA,a],[nameB,b]) => b.count-a.count || nameA.localeCompare(nameB))
    .slice(0,12)
    .map(([scientific_name,value]) => ({scientific_name,detection_count:value.count,last_detected:value.last_detected}));
  return jsonResponse({
    status:response.http_status===200?'ok':'error',
    range:'24h',
    recordings_analyzed:[...counts.values()].reduce((total,item) => total+item.count,0),
    species_detected:counts.size,
    animals,
  },response.http_status===200?200:502);
}

function validScientificName(value) {
  return typeof value === 'string' && value.length <= 92 && VALID_SPECIES.test(value) ? value.trim() : null;
}

async function fetchINaturalist(url) {
  try {
    const response = await fetch(url,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function lookupTaxon(scientificName) {
  const url = new URL(INATURALIST_TAXA);
  url.search = new URLSearchParams({q:scientificName,per_page:'10'}).toString();
  const data = await fetchINaturalist(url);
  const taxon = Array.isArray(data?.results) ? data.results.find(item => item?.name === scientificName) : null;
  if (!taxon) return {common_name:scientificName,taxon_url:'https://www.inaturalist.org/'};
  return {
    common_name:typeof taxon.preferred_common_name === 'string' && taxon.preferred_common_name ? taxon.preferred_common_name : scientificName,
    taxon_url:Number.isInteger(taxon.id)?`https://www.inaturalist.org/taxa/${taxon.id}`:'https://www.inaturalist.org/',
    photo:taxon.default_photo || null,
  };
}

function safeImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

export async function getWildlifeName(scientificName) {
  const name = validScientificName(scientificName);
  if (!name) return jsonResponse({error:'Provide one valid scientific species name.'},400);
  const taxon = await lookupTaxon(name);
  return jsonResponse({common_name:taxon.common_name},200);
}

export async function getWildlifeImage(scientificName) {
  const name = validScientificName(scientificName);
  if (!name) return jsonResponse({error:'Provide one valid scientific species name.'},400);
  const params = new URLSearchParams({
    taxon_name:name,
    photo_license:'CC-BY',
    per_page:'10',
    order_by:'votes',
    order:'desc',
    quality_grade:'research',
  });
  const observations = await fetchINaturalist(`${INATURALIST_OBSERVATIONS}?${params}`);
  const results = Array.isArray(observations?.results)?observations.results:[];
  for (const observation of results) {
    const taxon = observation?.taxon || {};
    if (taxon.name !== name && !String(taxon.name || '').startsWith(`${name} `)) continue;
    const photo = Array.isArray(observation.photos) ? observation.photos.find(item => String(item?.license_code || '').toLowerCase()==='cc-by' && safeImageUrl(item?.url)) : null;
    const imageUrl = safeImageUrl(photo?.url);
    if (!imageUrl) continue;
    return jsonResponse({
      common_name:taxon.preferred_common_name || name,
      image_url:imageUrl,
      image_attribution:photo.attribution || 'Photo via iNaturalist',
      taxon_url:Number.isInteger(observation.id)?`https://www.inaturalist.org/observations/${observation.id}`:'https://www.inaturalist.org/',
    },200);
  }

  const taxon = await lookupTaxon(name);
  const photo = taxon.photo || {};
  const imageUrl = photo.license_code?.toLowerCase()==='cc-by' ? safeImageUrl(photo.medium_url || photo.url) : null;
  if (!imageUrl) return jsonResponse({error:'No CC-BY reference image is available.'},404);
  return jsonResponse({
    common_name:taxon.common_name,
    image_url:imageUrl,
    image_attribution:photo.attribution || 'Photo via iNaturalist',
    taxon_url:taxon.taxon_url,
  },200);
}
