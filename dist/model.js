(() => {
  const canvas = document.querySelector('.scene-view');
  const experience = document.querySelector('.experience');
  const personElement = document.querySelector('.walking-person');
  const wildlife=[
    {element:document.querySelector('.wildlife-coyote'),point:[-42,-2,-80],width:55},
    {element:document.querySelector('.wildlife-owl'),point:[30,35,-115],width:26},
    {element:document.querySelector('.wildlife-frog'),point:[-15,-2,10],width:8},
    {element:document.querySelector('.wildlife-raccoon'),point:[28,-2,-115],width:30}
  ];
  const wildlifeLayer=document.querySelector('.wildlife-layer');
  const gl = canvas.getContext('webgl', {alpha:true,antialias:true});
  if (!gl || !window.BIOGLOW_STL || !window.BIOGLOW_SCENE_IMAGE || !window.BIOGLOW_DAY_IMAGE) return;
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(.025,.055,.035,1);
  const cameraSource=`
    uniform vec3 uEye,uRight,uUp,uForward;
    uniform float uAspect;
    vec4 project(vec3 p){
      vec3 v=p-uEye;
      float depth=dot(v,uForward);
      return vec4(dot(v,uRight)*2.5/uAspect,dot(v,uUp)*2.5,depth*1.01005-30.15075,depth);
    }`;
  const lampVertex=`attribute vec3 aPosition,aNormal; varying vec3 vNormal,vPosition,vView; varying float vHeight;
    uniform vec3 uPartOffset;
    ${cameraSource}
    void main(){vec3 position=aPosition+uPartOffset;vHeight=aPosition.y;vNormal=aNormal;vPosition=position;vView=uEye-position;gl_Position=project(position);}`;
  const lampFragment=`precision mediump float;varying vec3 vNormal,vPosition,vView;varying float vHeight;
    uniform vec3 uColor,uLightColor;uniform float uGlow,uClipTop,uGrain,uRoughness,uDiffuser,uDayMix,uDirectional,uBeamStrength,uLampIntensity;
    uniform vec2 uBeamDirection;
    const float PI=3.14159265;
    vec3 toneMap(vec3 x){
      return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);
    }
    vec3 lightBRDF(vec3 n,vec3 v,vec3 l,vec3 radiance,vec3 base,float roughness){
      vec3 h=normalize(v+l);
      float ndl=max(dot(n,l),0.0),ndv=max(dot(n,v),.001);
      float ndh=max(dot(n,h),0.0),hdv=max(dot(h,v),0.0);
      float a=roughness*roughness,a2=a*a;
      float d=a2/(PI*pow(ndh*ndh*(a2-1.0)+1.0,2.0)+.0001);
      float k=pow(roughness+1.0,2.0)/8.0;
      float g=(ndv/(ndv*(1.0-k)+k))*(ndl/(ndl*(1.0-k)+k));
      vec3 f=vec3(.04)+(vec3(1.0)-vec3(.04))*pow(1.0-hdv,5.0);
      vec3 diffuse=(vec3(1.0)-f)*base/PI;
      vec3 specular=d*g*f/(4.0*ndv*ndl+.001);
      return (diffuse+specular)*radiance*ndl;
    }
    void main(){
      if(uClipTop>0.0&&vHeight>uClipTop)discard;
      vec3 n=normalize(vNormal);
      vec3 v=normalize(vView);
      if(dot(n,v)<0.0)n=-n;
      if(uDiffuser>.5){
        float facing=abs(dot(n,v));
        float softEdge=.80+.20*smoothstep(0.0,.85,facing);
        vec3 transmission=uColor*(.38+uGlow*.88)*softEdge;
        if(uDirectional>.5){
          float segment=smoothstep(.68,.91,dot(normalize(vPosition.xz),uBeamDirection));
          transmission=vec3(.11)+uColor*uGlow*uBeamStrength*segment*1.25*softEdge;
        }
        transmission+=vec3(.035,.026,.014);
        // A bright diffuser reads nearly white; a dim one retains a warmer glow.
        float warmTint=.20+.30*(1.0-clamp(uLampIntensity,0.0,1.0));
        vec3 lit=pow(toneMap(transmission),vec3(1.0/2.2))*mix(vec3(1.0),uLightColor,warmTint);
        vec3 unlit=vec3(.09,.076,.06);
        // Convert low linear output to a visible display glow without changing the ground light.
        float visibleOutput=pow(clamp(uLampIntensity,0.0,1.0),.25);
        gl_FragColor=vec4(mix(unlit,lit,visibleOutput),1.0);
        return;
      }
      float grain=fract(sin(dot(floor(vPosition*6.0),vec3(12.9898,78.233,37.719)))*43758.5453);
      vec3 micro=vec3(sin(vPosition.x*19.0),sin(vPosition.y*23.0),sin(vPosition.z*21.0))*.12*uGrain;
      n=normalize(n+micro);
      vec3 base=uColor*(1.0+uGrain*(grain-.5));
      vec3 color=base*vec3(.23,.27,.31);
      color+=lightBRDF(n,v,normalize(vec3(-.52,.78,.58)),vec3(2.5,2.24,1.98),base,uRoughness);
      color+=lightBRDF(n,v,normalize(vec3(.72,.32,-.5)),vec3(.65,.80,1.08),base,uRoughness);
      float rim=pow(1.0-max(dot(n,v),0.0),3.0);
      color+=vec3(.035,.044,.054)*rim;
      gl_FragColor=vec4(pow(toneMap(color*mix(.38,.68,uDayMix)),vec3(1.0/2.2)),1.0);
    }`;
  const sceneVertex=`attribute vec3 aPosition;attribute vec2 aUV;varying vec2 vUV;varying vec3 vWorld;
    ${cameraSource}
    void main(){vUV=aUV;vWorld=aPosition;gl_Position=project(aPosition);}`;
  const sceneFragment=`precision mediump float;varying vec2 vUV;varying vec3 vWorld;
    uniform sampler2D uTextureNight,uTextureDay;uniform float uGround,uDayMix,uDirectional,uBeamStrength,uBeamDistance,uLampIntensity;uniform vec3 uLightColor;uniform vec2 uBeamDirection;
    void main(){
      vec3 nightBase=texture2D(uTextureNight,vUV).rgb;
      vec3 dayBase=texture2D(uTextureDay,vUV).rgb;
      vec3 base=mix(nightBase,dayBase,uDayMix);
      if(uGround<.5){gl_FragColor=vec4(base,1.0);return;}
      float distanceFromLamp=length(vWorld.xz);
      float pool=1.0-smoothstep(13.0,31.0,distanceFromLamp);
      float penumbra=1.0-smoothstep(26.0,46.0,distanceFromLamp);
      float alignment=dot(vWorld.xz/max(distanceFromLamp,.001),uBeamDirection);
      float beam=smoothstep(.68,.91,alignment)*(1.0-smoothstep(uBeamDistance+5.0,uBeamDistance+40.0,distanceFromLamp));
      pool=mix(pool,beam*uBeamStrength,uDirectional);
      penumbra=mix(penumbra,beam*uBeamStrength*.35,uDirectional);
      pool*=uLampIntensity;
      penumbra*=uLampIntensity;
      vec3 nightColor=nightBase*(.38+.58*pool+.10*penumbra)+uLightColor*(.16*pool+.025*penumbra);
      vec3 color=mix(nightColor,dayBase*.96,uDayMix);
      float contact=smoothstep(10.0,18.0,distanceFromLamp);
      color*=mix(.54,1.0,contact);
      gl_FragColor=vec4(min(color,vec3(1.0)),1.0);
    }`;
  const personVertex=`attribute vec3 aPosition;attribute vec2 aUV;varying vec2 vUV;varying vec3 vWorld;
    uniform float uOverhead;uniform vec3 uOffset;
    ${cameraSource}
    void main(){vec3 p=aPosition+(uOverhead>.5?vec3(0.0):uOffset);vUV=aUV;vWorld=p;gl_Position=project(p);}`;
  const personFragment=`precision highp float;varying vec2 vUV;varying vec3 vWorld;
    uniform sampler2D uPerson;uniform float uOpacity,uOverhead,uBeamStrength,uBeamDistance;uniform vec2 uFrame,uBeamDirection;
    float mirror(float value){float pair=mod(value,2.0);return pair<1.0?pair:2.0-pair;}
    void main(){
      vec2 atlasUV;
      if(uOverhead>.5){
        float v=vUV.y;
        if(v>1.0)v=.8+.2*mirror((v-1.0)*5.0);
        if(v<0.0)v=.78*mirror(v/.78);
        atlasUV=vec2(mirror(vUV.x),v);
      }else atlasUV=vec2((vUV.x+uFrame.x)*.25,(vUV.y+3.0-uFrame.y)*.25);
      vec4 photo=texture2D(uPerson,atlasUV);
      if(photo.a<.015)discard;
      vec3 color=photo.rgb*.82;
      if(uOverhead>.5){
        float radius=length(vWorld.xz);
        float alignment=dot(vWorld.xz/max(radius,.001),uBeamDirection);
        float sector=smoothstep(.68,.91,alignment);
        float reach=1.0-smoothstep(uBeamDistance+5.0,uBeamDistance+40.0,radius);
        float beam=sector*reach*uBeamStrength;
        color=photo.rgb*(.54+.45*beam)+vec3(.26,.17,.065)*beam;
        color*=mix(.54,1.0,smoothstep(10.0,18.0,radius));
      }
      gl_FragColor=vec4(min(color,vec3(1.0)),photo.a*uOpacity);
    }`;
  function program(vs,fs){
    function compile(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
    const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
  }
  const lampProgram=program(lampVertex,lampFragment),sceneProgram=program(sceneVertex,sceneFragment);
  let personProgram=null,personLoc=null;
  function cameraLocations(p){return {eye:gl.getUniformLocation(p,'uEye'),right:gl.getUniformLocation(p,'uRight'),up:gl.getUniformLocation(p,'uUp'),forward:gl.getUniformLocation(p,'uForward'),aspect:gl.getUniformLocation(p,'uAspect')}}
  const lampLoc={camera:cameraLocations(lampProgram),position:gl.getAttribLocation(lampProgram,'aPosition'),normal:gl.getAttribLocation(lampProgram,'aNormal'),offset:gl.getUniformLocation(lampProgram,'uPartOffset'),color:gl.getUniformLocation(lampProgram,'uColor'),lightColor:gl.getUniformLocation(lampProgram,'uLightColor'),glow:gl.getUniformLocation(lampProgram,'uGlow'),clip:gl.getUniformLocation(lampProgram,'uClipTop'),grain:gl.getUniformLocation(lampProgram,'uGrain'),roughness:gl.getUniformLocation(lampProgram,'uRoughness'),diffuser:gl.getUniformLocation(lampProgram,'uDiffuser'),dayMix:gl.getUniformLocation(lampProgram,'uDayMix'),directional:gl.getUniformLocation(lampProgram,'uDirectional'),beamDirection:gl.getUniformLocation(lampProgram,'uBeamDirection'),beamStrength:gl.getUniformLocation(lampProgram,'uBeamStrength'),intensity:gl.getUniformLocation(lampProgram,'uLampIntensity')};
  const sceneLoc={camera:cameraLocations(sceneProgram),position:gl.getAttribLocation(sceneProgram,'aPosition'),uv:gl.getAttribLocation(sceneProgram,'aUV'),night:gl.getUniformLocation(sceneProgram,'uTextureNight'),day:gl.getUniformLocation(sceneProgram,'uTextureDay'),dayMix:gl.getUniformLocation(sceneProgram,'uDayMix'),ground:gl.getUniformLocation(sceneProgram,'uGround'),lightColor:gl.getUniformLocation(sceneProgram,'uLightColor'),directional:gl.getUniformLocation(sceneProgram,'uDirectional'),beamDirection:gl.getUniformLocation(sceneProgram,'uBeamDirection'),beamStrength:gl.getUniformLocation(sceneProgram,'uBeamStrength'),beamDistance:gl.getUniformLocation(sceneProgram,'uBeamDistance'),intensity:gl.getUniformLocation(sceneProgram,'uLampIntensity')};
  function preparePersonRenderer(){
    if(personProgram)return;
    try{
      personProgram=program(personVertex,personFragment);
      personLoc={camera:cameraLocations(personProgram),position:gl.getAttribLocation(personProgram,'aPosition'),uv:gl.getAttribLocation(personProgram,'aUV'),texture:gl.getUniformLocation(personProgram,'uPerson'),opacity:gl.getUniformLocation(personProgram,'uOpacity'),overhead:gl.getUniformLocation(personProgram,'uOverhead'),offset:gl.getUniformLocation(personProgram,'uOffset'),frame:gl.getUniformLocation(personProgram,'uFrame'),beamDirection:gl.getUniformLocation(personProgram,'uBeamDirection'),beamStrength:gl.getUniformLocation(personProgram,'uBeamStrength'),beamDistance:gl.getUniformLocation(personProgram,'uBeamDistance')};
    }catch(error){console.error('Walking person renderer unavailable:',error)}
  }
  const specs=[
    {key:'foot',diameter:198,z:0,heightScale:1,color:[.055,.059,.063],glow:0},
    {key:'diffuser',diameter:25,z:15.1,heightScale:2,color:[1,1,1],glow:.65},
    {key:'upper',diameter:25,z:23.1,heightScale:1,radialScale:.93,color:[.05,.054,.058],glow:0},
    {key:'dome',diameter:25,z:23.1,heightScale:1,color:[.055,.059,.063],glow:0}
  ];
  function buffer(data){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return b}
  // The STL parts set the dimensions; these clean outer skins hide internal joins and the cap's mounting holes.
  function outerSkin(kind){
    const positions=[],normals=[];
    const around=kind==='diffuser'?288:160,levels=kind==='diffuser'?8:32;
    function point(i,j){
      const angle=i/around*Math.PI*2,t=j/levels,c=Math.cos(angle),s=Math.sin(angle);
      if(kind==='diffuser'){
        const rib=Math.cos(angle*48),r=12.42+.09*rib,dr=-.09*48*Math.sin(angle*48);
        const normal=[c+dr/r*s,0,s-dr/r*c],length=Math.hypot(...normal);
        return {p:[r*c,15.1+8*t,r*s],n:normal.map(v=>v/length)};
      }
      const circle=Math.sqrt(Math.max(0,1-t*t)),r=12.5*circle;
      return {p:[r*c,23.1+12.5*t,r*s],n:[circle*c,t,circle*s]};
    }
    function add(v){positions.push(...v.p);normals.push(...v.n)}
    for(let j=0;j<levels;j++)for(let i=0;i<around;i++){
      const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);
      for(const v of [a,b,c,a,c,d])add(v);
    }
    return {positions:new Float32Array(positions),normals:new Float32Array(normals)};
  }
  const meshes=specs.map(part=>{
    const raw=atob(window.BIOGLOW_STL[part.key]),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    const view=new DataView(bytes.buffer),count=view.getUint32(80,true);
    if(84+count*50!==bytes.length)throw Error('Invalid STL: '+part.key);
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity;
    for(let t=0;t<count;t++)for(let j=0;j<3;j++){
      const o=84+t*50+12+j*12,x=view.getFloat32(o,true),y=view.getFloat32(o+4,true),z=view.getFloat32(o+8,true);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);
    }
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2,scale=25/part.diameter;
    const positions=new Float32Array(count*9),normals=new Float32Array(count*9);
    for(let t=0;t<count;t++){
      const o=84+t*50,nx=view.getFloat32(o,true),ny=view.getFloat32(o+4,true),nz=view.getFloat32(o+8,true),len=Math.hypot(nx,ny,nz)||1;
      for(let j=0;j<3;j++){
        const v=o+12+j*12,i=t*9+j*3;
        positions[i]=(view.getFloat32(v,true)-cx)*scale*(part.radialScale||1);
        positions[i+1]=(view.getFloat32(v+8,true)-minZ)*scale*part.heightScale+part.z;
        positions[i+2]=-(view.getFloat32(v+4,true)-cy)*scale*(part.radialScale||1);
        normals[i]=nx/len;normals[i+1]=nz/len;normals[i+2]=-ny/len;
      }
    }
    const visible=(part.key==='diffuser'||part.key==='dome')?outerSkin(part.key):{positions,normals};
    return {part,position:buffer(visible.positions),normal:buffer(visible.normals),count:visible.positions.length/3};
  });
  function surface(corners,uvs){
    const positions=[],tex=[];
    for(const i of [0,1,2,0,2,3]){positions.push(...corners[i]);tex.push(...uvs[i])}
    return {position:buffer(new Float32Array(positions)),uv:buffer(new Float32Array(tex)),count:6,ground:true};
  }
  function hedge(){
    const positions=[],tex=[],segments=32;
    for(let i=0;i<segments;i++){
      const corners=[i,i+1].map(step=>{
        const u=step/segments,x=(u-.5)*440,z=-110+8*Math.pow(Math.abs(x)/220,1.8);
        return {x,z,u};
      });
      for(const [edge,top] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]){
        const point=corners[edge];
        positions.push(point.x,top?110:-2,point.z);
        tex.push(point.u,top?1:.58);
      }
    }
    return {position:buffer(new Float32Array(positions)),uv:buffer(new Float32Array(tex)),count:segments*6,ground:false};
  }
  const surfaces=[
    surface([[-180,-2,-55],[180,-2,-55],[160,-2,55],[-160,-2,55]],[[0,.38],[1,.38],[1,0],[0,0]]),
    surface([[-220,-2,-110],[220,-2,-110],[180,-2,-55],[-180,-2,-55]],[[0,.58],[1,.58],[1,.38],[0,.38]]),
    hedge()
  ];
  // 198 mm STL diameter maps to 25 scene units. A typical 450 mm adult shoulder span
  // occupies 75.5% of the cutout image, so its visible width is scaled to 450 mm.
  const personWidth=25*(450/198)/.755;
  const personDepth=personWidth*(1240/1269);
  const personX=70;
  const adultHeadHeight=1700/(198/25);
  const overheadSurface=surface([
    [-1200,-1,-1000],[1200,-1,-1000],[1200,-1,1000],[-1200,-1,1000]
  ],[[-.7,2.16667],[1.7,2.16667],[1.7,-1.16667],[-.7,-1.16667]]);
  function makeTexture(){
    const result=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,result);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return result;
  }
  const nightTexture=makeTexture(),dayTexture=makeTexture(),overheadTexture=makeTexture();
  let loadedImages=0,imageReady=false;
  function loadImage(source,target){
    const img=new Image();
    img.onload=()=>{
      gl.bindTexture(gl.TEXTURE_2D,target);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      imageReady=++loadedImages===2;
      draw();
    };
    img.src=source;
  }
  loadImage(window.BIOGLOW_SCENE_IMAGE,nightTexture);
  loadImage(window.BIOGLOW_DAY_IMAGE,dayTexture);
  let overheadReady=false;
  const overheadImage=new Image();
  overheadImage.onload=()=>{
    gl.bindTexture(gl.TEXTURE_2D,overheadTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,overheadImage);
    overheadReady=true;
    draw();
  };
  overheadImage.src=window.BIOGLOW_OVERHEAD_IMAGE;
  // Approximate 2700 K tungsten light in display RGB. All demos share this hue.
  const lampLightColor=[1,.69,.4];
  let yaw=0,elevation=.16,radius=72,frameX=0,focusY=17,drag=null,dayMix=0,dayTarget=0,fadeFrame=0;
  let activeDemo=0,returnPose=null,wildlifeReturnPose=null,migrationReturnPose=null,insideReturnPose=null,cameraFrame=0;
  let explodeProgress=0,explodeFrame=0;
  const personPosition={x:personX,z:0};
  let personTarget=null,personPath=[],personRow=3,personFrame=1,personBob=0,walkPhase=0,walkFrame=0,lastWalkTime=0;
  function normalize(v){const l=Math.hypot(...v)||1;return v.map(x=>x/l)}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
  function camera(){
    const target=[frameX,focusY,0],horizontal=Math.cos(elevation)*radius;
    const eye=[target[0]+Math.sin(yaw)*horizontal,target[1]+Math.sin(elevation)*radius,Math.cos(yaw)*horizontal];
    const forward=normalize(target.map((x,i)=>x-eye[i]));
    const right=[Math.cos(yaw),0,-Math.sin(yaw)];
    const up=normalize(cross(right,forward));
    return {eye,right,up,forward};
  }
  function groundPoint(clientX,clientY){
    const rect=canvas.getBoundingClientRect(),c=camera();
    const nx=2*(clientX-rect.left)/rect.width-1;
    const ny=1-2*(clientY-rect.top)/rect.height;
    const direction=normalize(c.forward.map((value,i)=>value+c.right[i]*nx*(rect.width/rect.height)/2.5+c.up[i]*ny/2.5));
    if(direction[1]>=-.001)return null;
    const distance=(adultHeadHeight-c.eye[1])/direction[1];
    return {x:Math.max(-450,Math.min(450,c.eye[0]+direction[0]*distance)),z:Math.max(-260,Math.min(260,c.eye[2]+direction[2]*distance))};
  }
  function outsideLamp(point){
    const distance=Math.hypot(point.x,point.z);
    if(distance>=34)return point;
    const direction=distance>1?{x:point.x/distance,z:point.z/distance}:{x:personPosition.x/Math.hypot(personPosition.x,personPosition.z),z:personPosition.z/Math.hypot(personPosition.x,personPosition.z)};
    return {x:direction.x*34,z:direction.z*34};
  }
  function routeTo(destination){
    const start=personPosition,dx=destination.x-start.x,dz=destination.z-start.z,lengthSquared=dx*dx+dz*dz;
    if(lengthSquared<1)return [destination];
    const t=Math.max(0,Math.min(1,-(start.x*dx+start.z*dz)/lengthSquared));
    const closest={x:start.x+dx*t,z:start.z+dz*t};
    if(t<=0||t>=1||Math.hypot(closest.x,closest.z)>=34)return [destination];
    const fromAngle=Math.atan2(start.z,start.x),toAngle=Math.atan2(destination.z,destination.x);
    const turn=Math.atan2(Math.sin(toAngle-fromAngle),Math.cos(toAngle-fromAngle));
    const steps=Math.max(1,Math.ceil(Math.abs(turn)/(Math.PI/6)));
    const route=[];
    for(let i=0;i<=steps;i++){
      const angle=fromAngle+turn*i/steps;
      route.push({x:45*Math.cos(angle),z:45*Math.sin(angle)});
    }
    route.push(destination);
    return route;
  }
  function faceTravel(dx,dz){
    const c=camera(),screenX=dx*c.right[0]+dz*c.right[2],screenY=dx*c.up[0]+dz*c.up[2];
    personRow=Math.abs(screenY)>Math.abs(screenX)?(screenY>0?1:0):(screenX<0?2:3);
  }
  function walk(now){
    const elapsed=lastWalkTime?Math.min((now-lastWalkTime)/1000,.05):0;
    lastWalkTime=now;
    if(personTarget){
      const dx=personTarget.x-personPosition.x,dz=personTarget.z-personPosition.z,distance=Math.hypot(dx,dz);
      if(distance<.8){
        personPosition.x=personTarget.x;personPosition.z=personTarget.z;
        personTarget=personPath.shift()||null;
      }else{
        const step=Math.min(distance,145*elapsed);
        personPosition.x+=dx/distance*step;personPosition.z+=dz/distance*step;
        faceTravel(dx,dz);
        walkPhase+=elapsed*5.2;
        personFrame=Math.floor(walkPhase)%4;
        personBob=1.1*Math.abs(Math.sin(walkPhase*Math.PI));
      }
    }
    if(!personTarget){personFrame=1;personBob=0;walkFrame=0;lastWalkTime=0;}
    draw();
    if(personTarget)walkFrame=requestAnimationFrame(walk);
  }
  function startWalk(point){
    if(!point)return;
    const route=routeTo(outsideLamp(point));
    personTarget=route.shift();personPath=route;
    cancelAnimationFrame(walkFrame);
    lastWalkTime=0;
    walkFrame=requestAnimationFrame(walk);
  }
  function personAt(clientX,clientY){
    if(activeDemo!==2||personElement.style.display==='none')return false;
    const bounds=personElement.getBoundingClientRect();
    const sidePadding=bounds.width*.22;
    return clientX>=bounds.left+sidePadding&&clientX<=bounds.right-sidePadding&&clientY>=bounds.top&&clientY<=bounds.bottom;
  }
  function stopPersonDrag(){
    personFrame=1;
    personBob=0;
    draw();
  }
  function setCamera(loc,c){
    gl.uniform3fv(loc.eye,c.eye);gl.uniform3fv(loc.right,c.right);gl.uniform3fv(loc.up,c.up);gl.uniform3fv(loc.forward,c.forward);gl.uniform1f(loc.aspect,canvas.width/canvas.height);
  }
  function draw(){
    if(!imageReady)return;
    const bounds=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(bounds.width*dpr)),h=Math.max(1,Math.round(bounds.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}
    gl.clearColor(.025+.43*dayMix,.055+.52*dayMix,.035+.42*dayMix,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const c=camera();
    const mode=Number(experience.dataset.demo)||0;
    const lampIntensity=(mode===4?Number(experience.dataset.migrationIntensity||1):1)*(mode===1?1-dayMix:1);
    const beamDistance=Math.max(1,Math.hypot(personPosition.x,personPosition.z));
    const beamDirection=[personPosition.x/beamDistance,personPosition.z/beamDistance];
    const beamProgress=Math.max(0,Math.min(1,(beamDistance-35)/150));
    const beamStrength=.85+1.15*beamProgress*beamProgress*(3-2*beamProgress);
    if(mode===3){
      const lampRelative=[-c.eye[0],17-c.eye[1],-c.eye[2]];
      const lampDepth=lampRelative.reduce((sum,value,i)=>sum+value*c.forward[i],0);
      const lampScreenX=lampRelative.reduce((sum,value,i)=>sum+value*c.right[i],0)*2.5/lampDepth;
      wildlifeLayer.style.setProperty('--wildlife-lamp-x',`${bounds.width/2+lampScreenX*bounds.height/2}px`);
      for(const animal of wildlife){
        if(!animal.element)continue;
        const relative=animal.point.map((value,i)=>value-c.eye[i]);
        const depth=relative.reduce((sum,value,i)=>sum+value*c.forward[i],0);
        if(depth<=15){animal.element.style.visibility='hidden';continue;}
        const screenX=relative.reduce((sum,value,i)=>sum+value*c.right[i],0)*2.5/depth;
        const screenY=relative.reduce((sum,value,i)=>sum+value*c.up[i],0)*2.5/depth;
        animal.element.style.visibility='visible';
        animal.element.style.left=`${bounds.width/2+screenX*bounds.height/2}px`;
        animal.element.style.top=`${bounds.height/2-screenY*bounds.height/2}px`;
        animal.element.style.width=`${animal.width*2.5*bounds.height/(2*depth)}px`;
      }
    }
    if(imageReady){
      gl.useProgram(sceneProgram);setCamera(sceneLoc.camera,c);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,nightTexture);gl.uniform1i(sceneLoc.night,0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dayTexture);gl.uniform1i(sceneLoc.day,1);
      gl.uniform1f(sceneLoc.dayMix,dayMix);
      gl.uniform1f(sceneLoc.directional,mode===2?1:0);
      gl.uniform2fv(sceneLoc.beamDirection,beamDirection);
      gl.uniform1f(sceneLoc.beamStrength,beamStrength);
      gl.uniform1f(sceneLoc.beamDistance,beamDistance);
      gl.uniform1f(sceneLoc.intensity,lampIntensity);
      gl.uniform3fv(sceneLoc.lightColor,lampLightColor);
      gl.enableVertexAttribArray(sceneLoc.position);gl.enableVertexAttribArray(sceneLoc.uv);
      for(const mesh of surfaces){
        gl.uniform1f(sceneLoc.ground,mesh.ground?1:0);
        gl.bindBuffer(gl.ARRAY_BUFFER,mesh.position);gl.vertexAttribPointer(sceneLoc.position,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,mesh.uv);gl.vertexAttribPointer(sceneLoc.uv,2,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.TRIANGLES,0,mesh.count);
      }
      gl.disableVertexAttribArray(sceneLoc.uv);gl.disableVertexAttribArray(sceneLoc.position);
    }
    const overheadProgress=Math.max(0,Math.min(1,(elevation-.74)/.55));
    const overheadOpacity=mode===5?0:overheadProgress*overheadProgress*(3-2*overheadProgress);
    const personOpacity=Math.max(0,Math.min(1,(elevation-.9)/.45));
    if(personElement){
      if(mode===2&&personOpacity>.01){
        const position=[personPosition.x,adultHeadHeight+personBob,personPosition.z];
        const relative=position.map((value,i)=>value-c.eye[i]);
        const depth=relative.reduce((sum,value,i)=>sum+value*c.forward[i],0);
        if(depth>15){
          const screenX=relative.reduce((sum,value,i)=>sum+value*c.right[i],0)*2.5/depth;
          const screenY=relative.reduce((sum,value,i)=>sum+value*c.up[i],0)*2.5/depth;
          const size=2.5*bounds.height/(2*depth);
          personElement.style.display='block';
          personElement.style.left=`${bounds.width/2+screenX*bounds.height/2}px`;
          personElement.style.top=`${bounds.height/2-screenY*bounds.height/2}px`;
          personElement.style.width=`${personWidth*size}px`;
          personElement.style.height=`${personDepth*size*Math.sin(elevation)}px`;
          personElement.style.opacity=personOpacity;
          personElement.style.backgroundPosition=`${personFrame*100/3}% ${personRow*100/3}%`;
          personElement.style.filter=`brightness(${.83+.3*beamStrength})`;
        }else personElement.style.display='none';
      }else personElement.style.display='none';
    }
    if(personLoc&&overheadReady&&overheadOpacity>.01){
      gl.useProgram(personProgram);setCamera(personLoc.camera,c);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.enableVertexAttribArray(personLoc.position);gl.enableVertexAttribArray(personLoc.uv);
      gl.activeTexture(gl.TEXTURE2);gl.uniform1i(personLoc.texture,2);
      gl.uniform2fv(personLoc.beamDirection,beamDirection);
      gl.uniform1f(personLoc.beamStrength,beamStrength);
      gl.uniform1f(personLoc.beamDistance,beamDistance);
      if(overheadReady&&overheadOpacity>.01){
        gl.disable(gl.DEPTH_TEST);
        gl.bindTexture(gl.TEXTURE_2D,overheadTexture);
        gl.uniform1f(personLoc.opacity,overheadOpacity);gl.uniform1f(personLoc.overhead,1);
        gl.uniform3fv(personLoc.offset,[0,0,0]);gl.uniform2fv(personLoc.frame,[0,0]);
        gl.bindBuffer(gl.ARRAY_BUFFER,overheadSurface.position);gl.vertexAttribPointer(personLoc.position,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,overheadSurface.uv);gl.vertexAttribPointer(personLoc.uv,2,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.TRIANGLES,0,overheadSurface.count);
        gl.enable(gl.DEPTH_TEST);
      }
      gl.disableVertexAttribArray(personLoc.position);gl.disableVertexAttribArray(personLoc.uv);
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
    gl.useProgram(lampProgram);setCamera(lampLoc.camera,c);
    gl.uniform3fv(lampLoc.lightColor,lampLightColor);
    gl.uniform1f(lampLoc.dayMix,dayMix);
    gl.uniform1f(lampLoc.intensity,lampIntensity);
    gl.uniform1f(lampLoc.directional,mode===2?1:0);
    gl.uniform2fv(lampLoc.beamDirection,beamDirection);
    gl.uniform1f(lampLoc.beamStrength,beamStrength);
    gl.enableVertexAttribArray(lampLoc.position);gl.enableVertexAttribArray(lampLoc.normal);
    const explodedHeights={foot:0,diffuser:7,upper:21,dome:34};
    for(const mesh of meshes){
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.position);gl.vertexAttribPointer(lampLoc.position,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.normal);gl.vertexAttribPointer(lampLoc.normal,3,gl.FLOAT,false,0,0);
      gl.uniform3fv(lampLoc.offset,[0,explodedHeights[mesh.part.key]*explodeProgress,0]);
      const isDiffuser=mesh.part.key==='diffuser';
      const unlitColor=[.74,.74,.71];
      gl.uniform3fv(lampLoc.color,isDiffuser?mesh.part.color.map((value,i)=>value*(1-dayMix)+unlitColor[i]*dayMix):mesh.part.color);
      gl.uniform1f(lampLoc.glow,mesh.part.glow*(1-dayMix));
      gl.uniform1f(lampLoc.diffuser,isDiffuser?1:0);
      gl.uniform1f(lampLoc.clip,mesh.part.key==='foot'?15.1:0);
      gl.uniform1f(lampLoc.grain,mesh.part.key==='diffuser'?0:.08);
      gl.uniform1f(lampLoc.roughness,mesh.part.key==='dome'?.68:.82);
      gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    }
    gl.disableVertexAttribArray(lampLoc.position);gl.disableVertexAttribArray(lampLoc.normal);
    if(!experience.classList.contains('scene-ready')&&gl.getError()===gl.NO_ERROR)experience.classList.add('scene-ready');
  }
  function syncLight(){
    const next=experience.dataset.light==='day'?1:0;
    if(next===dayTarget){draw();return;}
    dayTarget=next;
    cancelAnimationFrame(fadeFrame);
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){dayMix=next;draw();return;}
    const from=dayMix,start=performance.now(),duration=850;
    function fade(now){
      const progress=Math.min(1,(now-start)/duration);
      const eased=progress*progress*(3-2*progress);
      dayMix=from+(dayTarget-from)*eased;
      draw();
      if(progress<1)fadeFrame=requestAnimationFrame(fade);
    }
    fadeFrame=requestAnimationFrame(fade);
  }
  function animateCamera(to,onComplete){
    cancelAnimationFrame(cameraFrame);
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      yaw=to.yaw;elevation=to.elevation;radius=to.radius;frameX=to.frameX||0;focusY=to.focusY??17;draw();onComplete?.();return;
    }
    const from={yaw,elevation,radius,frameX,focusY},start=performance.now(),duration=1150;
    function step(now){
      const progress=Math.min(1,(now-start)/duration);
      const eased=progress*progress*(3-2*progress);
      yaw=from.yaw+(to.yaw-from.yaw)*eased;
      elevation=from.elevation+(to.elevation-from.elevation)*eased;
      radius=from.radius+(to.radius-from.radius)*eased;
      frameX=from.frameX+((to.frameX||0)-from.frameX)*eased;
      focusY=from.focusY+((to.focusY??17)-from.focusY)*eased;
      draw();
      if(progress<1)cameraFrame=requestAnimationFrame(step);
      else onComplete?.();
    }
    cameraFrame=requestAnimationFrame(step);
  }
  function animateExplosion(target){
    cancelAnimationFrame(explodeFrame);
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){explodeProgress=target;draw();return;}
    const from=explodeProgress,start=performance.now(),duration=1150;
    function step(now){
      const progress=Math.min(1,(now-start)/duration);
      const eased=progress*progress*(3-2*progress);
      explodeProgress=from+(target-from)*eased;
      draw();
      if(progress<1)explodeFrame=requestAnimationFrame(step);
    }
    explodeFrame=requestAnimationFrame(step);
  }
  function syncDemo(){
    const next=Number(experience.dataset.demo)||0;
    if(next!==activeDemo){
      canvas.style.cursor='';
      experience.classList.remove('wildlife-visible');
      animateExplosion(next===5?1:0);
      if(next===2){
        preparePersonRenderer();
        returnPose=activeDemo===3?(wildlifeReturnPose||{yaw:0,elevation:.16,radius:72}):activeDemo===4?(migrationReturnPose||{yaw:0,elevation:.16,radius:72}):activeDemo===5?(insideReturnPose||{yaw:0,elevation:.16,radius:72}):{yaw,elevation,radius,frameX,focusY};
        wildlifeReturnPose=null;
        migrationReturnPose=null;
        insideReturnPose=null;
        animateCamera({yaw:0,elevation:Math.PI/2,radius:500});
      }else if(next===3){
        if(activeDemo===2){
          cancelAnimationFrame(walkFrame);walkFrame=0;personTarget=null;personPath=[];personFrame=1;personBob=0;
          wildlifeReturnPose=returnPose||{yaw:0,elevation:.16,radius:72};
          returnPose=null;
        }else wildlifeReturnPose=activeDemo===4?(migrationReturnPose||{yaw:0,elevation:.16,radius:72}):activeDemo===5?(insideReturnPose||{yaw:0,elevation:.16,radius:72}):{yaw,elevation,radius,frameX,focusY};
        migrationReturnPose=null;
        insideReturnPose=null;
        animateCamera({yaw:0,elevation:.12,radius:105,frameX:12},()=>{
          if(experience.dataset.demo==='3')experience.classList.add('wildlife-visible');
        });
      }else if(next===4){
        if(activeDemo===2){
          cancelAnimationFrame(walkFrame);walkFrame=0;personTarget=null;personPath=[];personFrame=1;personBob=0;
          migrationReturnPose=returnPose||{yaw:0,elevation:.16,radius:72};
          returnPose=null;
        }else if(activeDemo===3){
          migrationReturnPose=wildlifeReturnPose||{yaw:0,elevation:.16,radius:72};
          wildlifeReturnPose=null;
        }else migrationReturnPose=activeDemo===5?(insideReturnPose||{yaw:0,elevation:.16,radius:72}):{yaw,elevation,radius,frameX,focusY};
        insideReturnPose=null;
        animateCamera({yaw:0,elevation:.12,radius:105,frameX:-17});
      }else if(next===5){
        if(activeDemo===2){
          cancelAnimationFrame(walkFrame);walkFrame=0;personTarget=null;personPath=[];personFrame=1;personBob=0;
          insideReturnPose=returnPose||{yaw:0,elevation:.16,radius:72};
          returnPose=null;
        }else if(activeDemo===3){
          insideReturnPose=wildlifeReturnPose||{yaw:0,elevation:.16,radius:72};
          wildlifeReturnPose=null;
        }else if(activeDemo===4){
          insideReturnPose=migrationReturnPose||{yaw:0,elevation:.16,radius:72};
          migrationReturnPose=null;
        }else insideReturnPose={yaw,elevation,radius,frameX,focusY};
        animateCamera({yaw:0,elevation:.24,radius:145,frameX:0,focusY:35});
      }else if(activeDemo===2){
        cancelAnimationFrame(walkFrame);walkFrame=0;personTarget=null;personPath=[];personFrame=1;personBob=0;
        animateCamera(returnPose||{yaw:0,elevation:.16,radius:72});
        returnPose=null;
      }else if(activeDemo===3){
        animateCamera(wildlifeReturnPose||{yaw:0,elevation:.16,radius:72});
        wildlifeReturnPose=null;
      }else if(activeDemo===4){
        animateCamera(migrationReturnPose||{yaw:0,elevation:.16,radius:72});
        migrationReturnPose=null;
      }else if(activeDemo===5){
        animateCamera(insideReturnPose||{yaw:0,elevation:.16,radius:72});
        insideReturnPose=null;
      }
      activeDemo=next;
    }
    syncLight();
  }
  canvas.addEventListener('pointerdown',e=>{
    const person=personAt(e.clientX,e.clientY);
    const grabPoint=person?groundPoint(e.clientX,e.clientY):null;
    drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,locked:activeDemo===2,person,grabOffset:grabPoint?{x:grabPoint.x-personPosition.x,z:grabPoint.z-personPosition.z}:null};
    if(person){
      cancelAnimationFrame(walkFrame);
      walkFrame=0;personTarget=null;personPath=[];lastWalkTime=0;
      canvas.style.cursor='grabbing';
    }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag){canvas.style.cursor=personAt(e.clientX,e.clientY)?'grab':'';return;}
    if(drag.locked){
      if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>=5)drag.moved=true;
      if(drag.person&&drag.moved){
        const point=groundPoint(e.clientX,e.clientY);
        if(point){
          const next=outsideLamp({x:Math.max(-450,Math.min(450,point.x-drag.grabOffset.x)),z:Math.max(-260,Math.min(260,point.z-drag.grabOffset.z))});
          const dx=next.x-personPosition.x,dz=next.z-personPosition.z,distance=Math.hypot(dx,dz);
          if(distance>.01){
            faceTravel(dx,dz);
            walkPhase+=distance/18;
            personFrame=Math.floor(walkPhase)%4;
            personBob=.5*Math.abs(Math.sin(walkPhase*Math.PI));
            personPosition.x=next.x;personPosition.z=next.z;
            draw();
          }
        }
      }
      return;
    }
    if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5)return;
    if(!drag.moved){drag.moved=true;cancelAnimationFrame(cameraFrame)}
    yaw=Math.max(-.4,Math.min(.4,yaw+(e.clientX-drag.x)*.0035));
    const minElevation=.02,maxElevation=activeDemo===5?.9:.34;
    elevation=Math.max(minElevation,Math.min(maxElevation,elevation+(e.clientY-drag.y)*.0025));
    drag.x=e.clientX;drag.y=e.clientY;draw();
  });
  canvas.addEventListener('pointerup',e=>{
    if(drag?.person)stopPersonDrag();
    else if(drag?.locked&&!drag.moved&&activeDemo===2)startWalk(groundPoint(e.clientX,e.clientY));
    drag=null;
    canvas.style.cursor=personAt(e.clientX,e.clientY)?'grab':'';
  });
  canvas.addEventListener('pointercancel',()=>{if(drag?.person)stopPersonDrag();drag=null;canvas.style.cursor=''});
  canvas.addEventListener('pointerleave',()=>{if(!drag)canvas.style.cursor=''});
  canvas.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();
    if(activeDemo===2){
      const step=35;
      startWalk({x:personPosition.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),z:personPosition.z+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)});
      return;
    }
    cancelAnimationFrame(cameraFrame);
    if(e.key==='ArrowLeft')yaw=Math.max(-.4,yaw-.04);
    if(e.key==='ArrowRight')yaw=Math.min(.4,yaw+.04);
    if(e.key==='ArrowUp')elevation=Math.min(activeDemo===5?.9:.34,elevation+.03);
    if(e.key==='ArrowDown')elevation=Math.max(.02,elevation-.03);
    draw();
  });
  new ResizeObserver(draw).observe(canvas);
  new MutationObserver(syncDemo).observe(experience,{attributes:true,attributeFilter:['data-demo','data-light']});
  window.addEventListener('bioglow:migration',draw);
  draw();
})();
