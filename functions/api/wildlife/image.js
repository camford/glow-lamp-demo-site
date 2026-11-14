import {getWildlifeImage} from '../../_lib/wildlife.js';
import {jsonResponse} from '../../_lib/bioglow.js';

export function onRequestGet({request,env}) {
  const url = new URL(request.url);
  const names = url.searchParams.getAll('species');
  const commonNames = url.searchParams.getAll('common_name');
  if (names.length !== 1 || commonNames.length > 1 || [...url.searchParams.keys()].some(key => !['species','common_name'].includes(key))) return jsonResponse({error:'Provide one species parameter and an optional common_name.'},400);
  return getWildlifeImage(names[0],env,commonNames[0] || '');
}
