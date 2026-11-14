import {controlDirection, readDirection} from '../../_lib/direction.js';

export function onRequestGet({env}) {
  return readDirection(env);
}

export function onRequestPost({request,env}) {
  return controlDirection(request,env);
}
