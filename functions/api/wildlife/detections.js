import {getWildlifeDetections} from '../../_lib/wildlife.js';

export function onRequestGet({env}) {
  return getWildlifeDetections(env);
}
