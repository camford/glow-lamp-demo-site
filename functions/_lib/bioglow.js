const DEFAULT_BIOGLOW_API_BASE = 'http://glow.ultraviolet.nirtech.org';
const STATION_ENDPOINTS = Object.freeze({
  latest:'/v1/latest',
  mode:'/v1/station-mode',
  direction:'/v1/direction',
  history:'/v1/history?source=microphone&range=1d',
});

function stationApiBase(env) {
  const configuredBase = typeof env?.BIOGLOW_API_BASE === 'string' ? env.BIOGLOW_API_BASE : DEFAULT_BIOGLOW_API_BASE;
  try {
    const configuredUrl = new URL(configuredBase);
    if (configuredUrl.protocol === 'http:' && configuredUrl.hostname === 'glow.ultraviolet.nirtech.org') {
      return configuredUrl.origin;
    }
  } catch {
    return DEFAULT_BIOGLOW_API_BASE;
  }
  return DEFAULT_BIOGLOW_API_BASE;
}

export async function fetchStationJson(env, endpoint, {method = 'GET', body} = {}) {
  const path = STATION_ENDPOINTS[endpoint];
  if (!path || (method !== 'GET' && !(method === 'POST' && ['mode','direction'].includes(endpoint)))) {
    return {http_status:400,data:{error:'Unsupported station route or method'}};
  }
  try {
    const headers = new Headers({Accept:'application/json','User-Agent':'Mozilla/5.0 BioGlow-dashboard/1.0'});
    if (body !== undefined) headers.set('Content-Type','application/json');
    const response = await fetch(`${stationApiBase(env)}${path}`, {
      method,
      headers,
      body:body === undefined ? undefined : JSON.stringify(body),
      redirect:'manual',
      signal: AbortSignal.timeout(10000),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return {http_status:response.status,data};
  } catch {
    return {http_status:null,data:null};
  }
}

export function fetchLatest(env) {
  return fetchStationJson(env,'latest');
}

export function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
    },
  });
}

const MIGRATION_FIELDS = [
  'status','region','source','retrieved_at','selected_night','live_feed',
  'migration_level','metrics','warnings',
];
const MIGRATION_METRIC_FIELDS = [
  'birds_in_flight','total_birds_crossed','direction','speed_mph',
  'altitude_ft','recorded_at','updated_at',
];

function projectMigration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = Object.fromEntries(MIGRATION_FIELDS.filter(key => key in value).map(key => [key,value[key]]));
  if (result.region && typeof result.region === 'object') {
    result.region = Object.fromEntries(['code','name'].filter(key => key in result.region).map(key => [key,result.region[key]]));
  }
  if (result.source && typeof result.source === 'object') {
    result.source = 'url' in result.source ? {url:result.source.url} : {};
  }
  if (result.metrics && typeof result.metrics === 'object') {
    result.metrics = Object.fromEntries(MIGRATION_METRIC_FIELDS.filter(key => key in result.metrics).map(key => [key,result.metrics[key]]));
  }
  if (Array.isArray(result.warnings)) result.warnings = result.warnings.filter(item => typeof item === 'string');
  return result;
}

export function dashboardPayload(latest) {
  const data = latest.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const source = data.sources?.birdcast || {};
    latest.data = {sources:{birdcast:{
      http_status:source.http_status,
      result:projectMigration(source.result),
      last_success:projectMigration(source.last_success),
    }}};
  }
  return {latest};
}
