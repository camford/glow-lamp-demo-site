import {dashboardPayload, fetchLatest, jsonResponse} from '../../_lib/bioglow.js';

export async function onRequestGet() {
  const latest = await fetchLatest();
  return jsonResponse(dashboardPayload(latest));
}
