import {dashboardPayload, fetchLatest, jsonResponse} from '../../_lib/bioglow.js';

export async function onRequestGet({env}) {
  const latest = await fetchLatest(env);
  return jsonResponse(dashboardPayload(latest));
}
