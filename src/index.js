import {onRequestGet as getLight} from '../functions/api/bioglow/light.js';
import {onRequestGet as getDashboard} from '../functions/api/bioglow/dashboard.js';
import {onRequestGet as getDirection,onRequestPost as postDirection} from '../functions/api/bioglow/direction.js';
import {onRequestGet as getWildlifeDetections} from '../functions/api/wildlife/detections.js';
import {onRequestGet as getWildlifeImage} from '../functions/api/wildlife/image.js';
import {onRequestGet as getWildlifeName} from '../functions/api/wildlife/name.js';
import {jsonResponse} from '../functions/_lib/bioglow.js';

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);

    if (pathname === '/api/bioglow/light') {
      if (request.method !== 'GET') return jsonResponse({error:'Method not allowed'},405);
      return getLight({request,env});
    }

    if (pathname === '/api/bioglow/dashboard') {
      if (request.method !== 'GET') return jsonResponse({error:'Method not allowed'},405);
      return getDashboard({request,env});
    }

    if (pathname === '/api/bioglow/direction') {
      if (request.method === 'GET') return getDirection({request,env});
      if (request.method === 'POST') return postDirection({request,env});
      return jsonResponse({error:'Method not allowed'},405);
    }

    if (pathname === '/api/wildlife/detections') {
      if (request.method !== 'GET') return jsonResponse({error:'Method not allowed'},405);
      return getWildlifeDetections({request,env});
    }

    if (pathname === '/api/wildlife/image') {
      if (request.method !== 'GET') return jsonResponse({error:'Method not allowed'},405);
      return getWildlifeImage({request,env});
    }

    if (pathname === '/api/wildlife/name') {
      if (request.method !== 'GET') return jsonResponse({error:'Method not allowed'},405);
      return getWildlifeName({request,env});
    }

    if (pathname.startsWith('/api/')) return jsonResponse({error:'Not found'},404);
    return env.ASSETS.fetch(request);
  },
};
