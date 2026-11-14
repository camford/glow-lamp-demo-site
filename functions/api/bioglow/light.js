import {fetchLatest, jsonResponse} from '../../_lib/bioglow.js';

export async function onRequestGet() {
  const latest = await fetchLatest();
  const lighting = latest.data?.lighting;
  if (latest.http_status !== 200 || !lighting || typeof lighting !== 'object') {
    return jsonResponse({status:'error',on:null,color:null},502);
  }

  const color = typeof lighting.color === 'string' && /^#[0-9a-f]{6}$/i.test(lighting.color)
    ? lighting.color
    : null;
  const result = {
    status:['ok','pending'].includes(lighting.status) ? 'ok' : 'error',
    on:typeof lighting.on === 'boolean' ? lighting.on : null,
    color,
    brightness:typeof lighting.brightness === 'number' && Number.isFinite(lighting.brightness) ? lighting.brightness : null,
    mode:typeof lighting.mode === 'string' ? lighting.mode : null,
  };
  return jsonResponse(result,result.status === 'ok' ? 200 : 502);
}
