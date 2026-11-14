import {fetchStationJson, jsonResponse} from './bioglow.js';

export async function readDirection(env) {
  const [modeResponse,directionResponse] = await Promise.all([
    fetchStationJson(env,'mode'),
    fetchStationJson(env,'direction'),
  ]);
  const mode = modeResponse.data || {};
  const direction = directionResponse.data || {};
  const ok = modeResponse.http_status === 200 && directionResponse.http_status === 200;
  return jsonResponse({
    status:ok?'ok':'error',
    mode:mode.mode ?? null,
    modes:Array.isArray(mode.modes)?mode.modes:[],
    angle_degrees:direction.angle_degrees ?? null,
    alignment:direction.alignment ?? null,
    beam_width:direction.beam_width ?? null,
    max_beam_width:direction.max_beam_width ?? null,
  },200);
}

export async function controlDirection(request, env) {
  const text = await request.text();
  if (text.length < 2 || text.length > 1024) return jsonResponse({status:'error',message:'Send a small JSON direction request.'},400);
  let input;
  try { input = JSON.parse(text); } catch { return jsonResponse({status:'error',message:'Invalid JSON request.'},400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return jsonResponse({status:'error',message:'Invalid direction request.'},400);

  if (input.action === 'stop' && Object.keys(input).every(key => ['action','restore_mode'].includes(key)) &&
      (input.restore_mode === undefined || ['normal','direction_config'].includes(input.restore_mode))) {
    if (!input.restore_mode) return jsonResponse({status:'ok',stopped:false});
    const current = await fetchStationJson(env,'mode');
    if (current.http_status !== 200) return jsonResponse({status:'error',message:'Could not read the station mode.'},502);
    if (current.data?.mode !== 'direction_config' || input.restore_mode === 'direction_config') {
      return jsonResponse({status:'ok',mode:current.data?.mode,stopped:false});
    }
    const restored = await fetchStationJson(env,'mode',{method:'POST',body:{mode:input.restore_mode}});
    return jsonResponse(restored.data || {status:'error'},restored.http_status === 200?200:(restored.http_status || 502));
  }

  if (Object.keys(input).length !== 2 || !Number.isInteger(input.angle) || input.angle < 0 || input.angle > 359 ||
      !Number.isInteger(input.beam_width)) {
    return jsonResponse({status:'error',message:'Provide an angle from 0 to 359 and an odd beam width.'},400);
  }

  const modeResponse = await fetchStationJson(env,'mode');
  if (modeResponse.http_status !== 200 || !modeResponse.data || typeof modeResponse.data !== 'object') {
    return jsonResponse({status:'error',message:'Could not read the station mode.'},502);
  }
  const originalMode = modeResponse.data.mode;
  if (!['normal','direction_config'].includes(originalMode)) {
    return jsonResponse({status:'error',message:`Station is in ${originalMode || 'an unknown'} mode; beam steering is unavailable.`},409);
  }
  const started = originalMode === 'normal';
  if (started) {
    const changed = await fetchStationJson(env,'mode',{method:'POST',body:{mode:'direction_config'}});
    if (changed.http_status !== 200) return jsonResponse(changed.data || {status:'error'},changed.http_status || 502);
  }

  const directionResponse = await fetchStationJson(env,'direction');
  const direction = directionResponse.data;
  if (directionResponse.http_status !== 200 || !direction || !Number.isInteger(direction.alignment) || direction.alignment < 1 ||
      !Number.isInteger(direction.max_beam_width) || direction.max_beam_width < 1) {
    if (started) await fetchStationJson(env,'mode',{method:'POST',body:{mode:originalMode}});
    return jsonResponse({status:'error',message:'The station returned invalid beam settings.'},502);
  }
  if (input.beam_width < 1 || input.beam_width > direction.max_beam_width || input.beam_width % 2 !== 1) {
    if (started) await fetchStationJson(env,'mode',{method:'POST',body:{mode:originalMode}});
    return jsonResponse({status:'error',message:`Beam width must be an odd number from 1 to ${direction.max_beam_width}.`},400);
  }
  const offset = Math.floor(input.angle * direction.alignment / 360 + .5) % direction.alignment;
  const updated = await fetchStationJson(env,'direction',{method:'POST',body:{
    alignment:direction.alignment,
    beam_width:input.beam_width,
    offset,
  }});
  if (updated.http_status !== 200) {
    if (started) await fetchStationJson(env,'mode',{method:'POST',body:{mode:originalMode}});
    return jsonResponse(updated.data || {status:'error'},updated.http_status || 502);
  }
  return jsonResponse({
    status:'ok',
    mode:'direction_config',
    angle_degrees:updated.data?.angle_degrees ?? input.angle,
    beam_width:updated.data?.beam_width ?? input.beam_width,
    max_beam_width:updated.data?.max_beam_width ?? direction.max_beam_width,
    started,
    original_mode:started?originalMode:null,
  });
}
