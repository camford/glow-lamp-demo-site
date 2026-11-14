import {fetchStationJson, jsonResponse} from './bioglow.js';

const INATURALIST_TAXA = 'https://api.inaturalist.org/v1/taxa';
const UNSPLASH_SEARCH = 'https://api.unsplash.com/search/photos';
const VALID_SPECIES = /^[A-Za-z][A-Za-z .'-]{1,90}$/;
const VALID_COMMON_NAME = /^[A-Za-z][A-Za-z .'-]{0,90}$/;
const ALLOWED_IMAGE_HOSTS = new Set(['images.unsplash.com']);
const WILDLIFE_WINDOW_MS = 24 * 60 * 60 * 1000;
const wildlifeImageCache = new Map();

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
  },200);
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

function plainHttpUrl(value, hostname) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname ? url.href : null;
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

export async function getWildlifeImage(scientificName, env, preferredCommonName = '') {
  const name = validScientificName(scientificName);
  if (!name) return jsonResponse({error:'Provide one valid scientific species name.'},400);
  const commonName = typeof preferredCommonName === 'string' && VALID_COMMON_NAME.test(preferredCommonName.trim())
    ? preferredCommonName.trim()
    : '';
  const cacheKey = `${name}|${commonName.toLowerCase()}`;
  const cached = wildlifeImageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return jsonResponse(cached.value,200);
  const accessKey = typeof env?.UNSPLASH_ACCESS_KEY === 'string' ? env.UNSPLASH_ACCESS_KEY.trim() : '';
  if (!accessKey) return jsonResponse({status:'error',error:'Unsplash image search is not configured.'},200);

  const taxon = commonName ? {common_name:commonName} : await lookupTaxon(name);
  const searchName = taxon.common_name && taxon.common_name !== name ? taxon.common_name : name;
  const params = new URLSearchParams({query:`${searchName} wildlife`,per_page:'10',content_filter:'high',orientation:'squarish'});
  try {
    const response = await fetch(`${UNSPLASH_SEARCH}?${params}`,{
      headers:{Accept:'application/json',Authorization:`Client-ID ${accessKey}`},
      signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) return jsonResponse({status:'error',error:`Unsplash image search returned ${response.status}.`},200);
    const data = await response.json();
    const photos = Array.isArray(data?.results) ? data.results : [];
    for (const photo of photos) {
      const imageUrl = safeImageUrl(photo?.urls?.small || photo?.urls?.regular);
      const photoUrl = plainHttpUrl(photo?.links?.html,'unsplash.com');
      const photographerUrl = plainHttpUrl(photo?.user?.links?.html,'unsplash.com');
      if (!imageUrl || !photoUrl || !photographerUrl) continue;
      const attributionUrl = new URL(photographerUrl);
      attributionUrl.searchParams.set('utm_source','bioglow_demo');
      attributionUrl.searchParams.set('utm_medium','referral');
      const value = {
        status:'ok',
        common_name:taxon.common_name || name,
        image_url:imageUrl,
        image_attribution:`Photo by ${String(photo.user.name || 'Unsplash photographer').slice(0,100)} on Unsplash`,
        attribution_url:attributionUrl.href,
        taxon_url:photoUrl,
      };
      wildlifeImageCache.set(cacheKey,{value,expiresAt:Date.now()+24*60*60*1000});
      return jsonResponse(value,200);
    }
    return jsonResponse({status:'error',error:'Unsplash has no matching animal photos.'},200);
  } catch {
    return jsonResponse({status:'error',error:'Unable to reach Unsplash image search.'},200);
  }
}
