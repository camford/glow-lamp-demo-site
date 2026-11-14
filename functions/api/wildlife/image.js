import {getWildlifeImage} from '../../_lib/wildlife.js';
import {jsonResponse} from '../../_lib/bioglow.js';

export function onRequestGet({request}) {
  const url = new URL(request.url);
  const names = url.searchParams.getAll('species');
  if ([...url.searchParams.keys()].length !== 1 || names.length !== 1) return jsonResponse({error:'Provide one species parameter.'},400);
  return getWildlifeImage(names[0]);
}
