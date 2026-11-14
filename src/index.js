import {onRequestGet as getLight} from '../functions/api/bioglow/light.js';
import {onRequestGet as getDashboard} from '../functions/api/bioglow/dashboard.js';
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

    if (pathname.startsWith('/api/')) return jsonResponse({error:'Not found'},404);
    return env.ASSETS.fetch(request);
  },
};
