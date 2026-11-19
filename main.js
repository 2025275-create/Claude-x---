import * as THREE from 'three';
import glbUrl from './character.glb?url';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ---------- noise / terrain height (pure function => seamless chunks, no loading) ----------
const hash=(x,y)=>{let h=Math.imul(x|0,374761393)+Math.imul(y|0,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;};
const sm=t=>t*t*(3-2*t);
function vnoise(x,y){const xi=Math.floor(x),yi=Math.floor(y),fx=sm(x-xi),fy=sm(y-yi);
  const a=hash(xi,yi),b=hash(xi+1,yi),c=hash(xi,yi+1),d=hash(xi+1,yi+1);return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;}
function fbm(x,y,o=4){let s=0,a=.5,f=1;for(let i=0;i<o;i++){s+=a*vnoise(x*f,y*f);f*=2.03;a*=.5;}return s;}
const sstep=(a,b,x)=>sm(Math.min(1,Math.max(0,(x-a)/(b-a))));
export function height(x,z){
  const n=fbm(x*.0035+11,z*.0035+7), m=Math.pow(n,2.3)*210;
  const r=1-Math.abs(2*fbm(x*.008+3,z*.008+9,3)-1);
  let h=m+r*r*38*sstep(.42,.75,n);
  const step=22, t=h/step, f=t-Math.floor(t);
  const terr=(Math.floor(t)+sstep(0,.12,f))*step;           // plateaus + sheer cliffs
  h=h+(terr-h)*.78;
  return h+fbm(x*.05,z*.05,3)*3.2-30;
}
const grad=(x,z)=>{const e=.8;return[(height(x+e,z)-height(x-e,z))/(2*e),(height(x,z+e)-height(x,z-e))/(2*e)];};

// ---------- renderer / sky (palette from reference image) ----------
const FOG=new THREE.Color(0xf3d6bd);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.fog=new THREE.Fog(FOG,60,330);
const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.1,900);
const SUN_DIR=new THREE.Vector3(.35,.55,-.75).normalize();
const sky=new THREE.Mesh(new THREE.SphereGeometry(700,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
  uniforms:{sun:{value:SUN_DIR}},
  vertexShader:'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`varying vec3 v;uniform vec3 sun;void main(){float h=clamp(v.y,0.,1.);
   vec3 c=mix(vec3(.96,.84,.72),vec3(.62,.70,.86),pow(h,.55));
   float s=max(dot(normalize(v),sun),0.);c+=vec3(1.,.9,.7)*(pow(s,6.)*.5+pow(s,400.)*3.);gl_FragColor=vec4(c,1.);}`}));
scene.add(sky);
scene.add(new THREE.HemisphereLight(0xffe6c8,0x8f9ccf,1.1));      // warm sky / lavender-blue shadow fill
const sun=new THREE.DirectionalLight(0xfff0d8,3.2);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);const sc=sun.shadow.camera;sc.left=sc.bottom=-70;sc.right=sc.top=70;sc.near=1;sc.far=400;
sun.shadow.bias=-.0006;sun.shadow.normalBias=.5;scene.add(sun,sun.target);

// ---------- chunks: terrain + grass + trees + rocks ----------
const CS=64,SEG=48,RAD=3;
const chunks=new Map();
const rng=s=>()=>((s=Math.imul(s^s>>>15,2246822519)+1013904223|0)>>>0)/4294967295;
const grassGeo=new THREE.BufferGeometry();
grassGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.07,0,0,.07,0,0,0,1,0,.07,0,0,-.07,0,0,0,1,0],3));
grassGeo.setAttribute('color',new THREE.Float32BufferAttribute([.25,.45,.15,.25,.45,.15,.85,.95,.45,.25,.45,.15,.25,.45,.15,.85,.95,.45],3));
grassGeo.setAttribute('normal',new THREE.Float32BufferAttribute(new Array(6).fill([0,1,0]).flat(),3));
const wind={value:0};
const grassMat=new THREE.MeshLambertMaterial({vertexColors:true});
grassMat.onBeforeCompile=s=>{s.uniforms.uT=wind;s.vertexShader='uniform float uT;\n'+s.vertexShader.replace('#include <begin_vertex>',
 '#include <begin_vertex>\n vec4 wp=instanceMatrix*vec4(transformed,1.);transformed.x+=sin(uT*1.7+wp.x*.4+wp.z*.3)*.25*position.y;transformed.z+=cos(uT*1.3+wp.z*.35)*.15*position.y;');};
const trunkGeo=new THREE.CylinderGeometry(.25,.5,5,6).translate(0,2.5,0);
const canopyGeo=(()=>{const pos=[];[[0,6,0,2.8],[1.3,5,.6,2],[-1.2,5.4,-.8,2.2]].forEach(([x,y,z,r])=>{
  const p=new THREE.IcosahedronGeometry(r,1).translate(x,y,z).toNonIndexed().attributes.position.array;for(const v of p)pos.push(v);});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;})();
const trunkMat=new THREE.MeshLambertMaterial({color:0x6b5039}),canopyMat=new THREE.MeshLambertMaterial({color:0x6fa04a,flatShading:true});
const rockGeo=(()=>{const g=new THREE.DodecahedronGeometry(1,1),p=g.attributes.position;for(let i=0;i<p.count;i++){const X=p.getX(i),Y=p.getY(i),Z=p.getZ(i),k=1+(hash(Math.round(X*50)+Math.round(Z*50)*131,Math.round(Y*50)+7)-.5)*.5;p.setXYZ(i,X*k*1.3,Y*k*.8,Z*k);}g.computeVertexNormals();return g;})();
const rockMat=new THREE.MeshLambertMaterial({color:0x9a9486,flatShading:true});
const terrMat=new THREE.MeshLambertMaterial({vertexColors:true});
const cG=new THREE.Color(0x7aa83f),cG2=new THREE.Color(0xb5b95a),cR=new THREE.Color(0x8d8779),cR2=new THREE.Color(0xb5a98f),tmp=new THREE.Color(),tmp2=new THREE.Color();
const dummy=new THREE.Object3D();
const shared=new Set([grassGeo,trunkGeo,canopyGeo,rockGeo]);

function buildChunk(cx,cz){
  const g=new THREE.Group(),ox=cx*CS,oz=cz*CS,r=rng(cx*73856093^cz*19349663);
  const geo=new THREE.PlaneGeometry(CS,CS,SEG,SEG);geo.rotateX(-Math.PI/2);
  const p=geo.attributes.position,col=new Float32Array(p.count*3),nor=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){const x=p.getX(i)+ox+CS/2,z=p.getZ(i)+oz+CS/2;p.setXYZ(i,x,height(x,z),z);
    const[gx,gz]=grad(x,z),sl=Math.hypot(gx,gz),nl=Math.hypot(gx,1,gz);nor[i*3]=-gx/nl;nor[i*3+1]=1/nl;nor[i*3+2]=-gz/nl;
    const rock=sstep(.75,1.3,sl+fbm(x*.1,z*.1,2)*.3);
    tmp.copy(cG).lerp(cG2,fbm(x*.02,z*.02,3));tmp2.copy(cR).lerp(cR2,fbm(x*.15,z*.15,2));tmp.lerp(tmp2,rock);
    col[i*3]=tmp.r;col[i*3+1]=tmp.g;col[i*3+2]=tmp.b;}
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));geo.setAttribute('normal',new THREE.BufferAttribute(nor,3));
  const t=new THREE.Mesh(geo,terrMat);t.receiveShadow=true;t.frustumCulled=false;g.add(t);
  const gr=[],tr=[],rk=[];
  for(let i=0;i<2600;i++){const x=ox+r()*CS,z=oz+r()*CS,[gx,gz]=grad(x,z);if(Math.hypot(gx,gz)<.7)gr.push([x,height(x,z),z,r()]);}
  for(let i=0;i<34;i++){const x=ox+r()*CS,z=oz+r()*CS,[gx,gz]=grad(x,z);if(Math.hypot(gx,gz)<.5&&fbm(x*.01,z*.01,2)>.45)tr.push([x,height(x,z),z,r()]);}
  for(let i=0;i<40;i++){const x=ox+r()*CS,z=oz+r()*CS,[gx,gz]=grad(x,z),sl=Math.hypot(gx,gz);if(sl>.6||r()<.1)rk.push([x,height(x,z)-.3,z,r(),sl]);}
  const mk=(geom,mat,list,fn,shadow)=>{if(!list.length)return;const m=new THREE.InstancedMesh(geom,mat,list.length);
    list.forEach((a,i)=>{fn(a);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);});m.castShadow=shadow;m.receiveShadow=true;m.frustumCulled=false;g.add(m);};
  mk(grassGeo,grassMat,gr,a=>{dummy.position.set(a[0],a[1],a[2]);dummy.rotation.set(0,a[3]*6.28,0);const s=.6+a[3]*.9;dummy.scale.set(s,s*1.1,s);},false);
  const tf=a=>{dummy.position.set(a[0],a[1]-.2,a[2]);dummy.rotation.set(0,a[3]*6,0);const s=.8+a[3]*1.2;dummy.scale.set(s,s,s);};
  mk(trunkGeo,trunkMat,tr,tf,true);mk(canopyGeo,canopyMat,tr,tf,true);
  mk(rockGeo,rockMat,rk,a=>{dummy.position.set(a[0],a[1],a[2]);dummy.rotation.set(a[3]*3,a[3]*9,a[3]*2);const s=.8+a[3]*a[3]*(a[4]>1?6:3.5);dummy.scale.set(s,s,s);},true);
  g.userData.dispose=()=>g.traverse(o=>{if(o.isMesh&&!shared.has(o.geometry))o.geometry.dispose();if(o.isInstancedMesh)o.dispose();});
  return g;
}
function streamChunks(px,pz,burst){
  const pcx=Math.floor(px/CS),pcz=Math.floor(pz/CS);
  for(const[k,g]of chunks)if(Math.max(Math.abs(g.userData.cx-pcx),Math.abs(g.userData.cz-pcz))>RAD+1){scene.remove(g);g.userData.dispose();chunks.delete(k);}
  const need=[];for(let dz=-RAD;dz<=RAD;dz++)for(let dx=-RAD;dx<=RAD;dx++){const k=(pcx+dx)+','+(pcz+dz);if(!chunks.has(k))need.push([dx*dx+dz*dz,pcx+dx,pcz+dz,k]);}
  need.sort((a,b)=>a[0]-b[0]);
  for(let i=0;i<(burst?need.length:1)&&i<need.length;i++){const[,cx,cz,k]=need[i];const g=buildChunk(cx,cz);g.userData.cx=cx;g.userData.cz=cz;chunks.set(k,g);scene.add(g);} // 1 chunk/frame => no loading screens
}

// ---------- player ----------
const P={pos:new THREE.Vector3(0,height(0,0)+.5,0),vel:new THREE.Vector3(),yaw:Math.PI,grounded:true,gliding:false,steep:false};
let loadMsg='キャラ読み込み中…';let model=null,holder=null,mixer=null,acts={},cur=null,wings=null;
const flip=new URLSearchParams(location.search).get('flip')==='1';   // ?flip=1 if the model walks backwards
function play(name,ts=1){const a=acts[name];if(!a)return;if(cur!==a){a.reset().fadeIn(.2).play();if(cur)cur.fadeOut(.2);cur=a;}a.timeScale=ts;}
function makeWings(h){const g=new THREE.Group(),m=new THREE.MeshStandardMaterial({color:0xe8eef5,metalness:.6,roughness:.35,side:THREE.DoubleSide});
  for(const s of[-1,1])for(let i=0;i<4;i++){const f=new THREE.Mesh(new THREE.BoxGeometry(h*.9,.01*h,h*.07),m);
    f.position.set(s*h*.45,h*.7,-h*.1);f.rotation.set(0,s*(i-1.5)*.18,s*(.25+i*.07));f.castShadow=true;g.add(f);}
  g.visible=false;return g;}
new GLTFLoader().load(glbUrl,gltf=>{
  model=gltf.scene;const box=new THREE.Box3().setFromObject(model),sc=1.75/(box.max.y-box.min.y);
  model.scale.setScalar(sc);model.position.y=-box.min.y*sc;
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;}});
  holder=new THREE.Group();holder.rotation.y=P.yaw+(flip?Math.PI:0);holder.add(model);wings=makeWings(1.75);holder.add(wings);scene.add(holder);
  mixer=new THREE.AnimationMixer(model);gltf.animations.forEach(c=>acts[c.name]=mixer.clipAction(c));
  clips=gltf.animations;play('Run',0);loadMsg='';
},e=>{loadMsg=`キャラ読み込み中 ${(e.loaded/1048576).toFixed(1)}MB`;},e=>{loadMsg='キャラ読み込み失敗: '+(e.message||e);});

// ---------- input (keyboard / mouse / touch) ----------
const keys={};let camYaw=0,camPitch=.35,camDist=7,jumpHeld=false,stick={x:0,y:0};
addEventListener('keydown',e=>{keys[e.code]=1;if(e.code==='Space'){jumpHeld=true;e.preventDefault();}});
addEventListener('keyup',e=>{keys[e.code]=0;if(e.code==='Space')jumpHeld=false;});
const cvs=renderer.domElement;let drag=null;
cvs.addEventListener('pointerdown',e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY};});
addEventListener('pointermove',e=>{if(drag&&e.pointerId===drag.id){camYaw-=(e.clientX-drag.x)*.006;camPitch=Math.min(1.2,Math.max(-.2,camPitch+(e.clientY-drag.y)*.005));drag.x=e.clientX;drag.y=e.clientY;}});
addEventListener('pointerup',e=>{if(drag&&e.pointerId===drag.id)drag=null;});
cvs.addEventListener('wheel',e=>{camDist=Math.min(16,Math.max(3,camDist+e.deltaY*.01));},{passive:true});
const st=document.getElementById('stick'),kn=document.getElementById('knob'),jb=document.getElementById('jump');let sid=null;
const sMove=e=>{const r=st.getBoundingClientRect(),dx=e.clientX-(r.left+65),dy=e.clientY-(r.top+65),l=Math.min(1,Math.hypot(dx,dy)/55),a=Math.atan2(dy,dx);
  stick.x=Math.cos(a)*l;stick.y=Math.sin(a)*l;kn.style.transform=`translate(${stick.x*45}px,${stick.y*45}px)`;};
st.addEventListener('pointerdown',e=>{sid=e.pointerId;st.setPointerCapture(sid);sMove(e);e.stopPropagation();});
st.addEventListener('pointermove',e=>{if(e.pointerId===sid)sMove(e);});
const sEnd=e=>{if(e.pointerId===sid){sid=null;stick.x=stick.y=0;kn.style.transform='';}};st.addEventListener('pointerup',sEnd);st.addEventListener('pointercancel',sEnd);
jb.addEventListener('pointerdown',e=>{jumpHeld=true;jb.setPointerCapture(e.pointerId);e.stopPropagation();});
const jEnd=()=>{jumpHeld=false;};jb.addEventListener('pointerup',jEnd);jb.addEventListener('pointercancel',jEnd);

// ---------- multiplayer (WebSocket) ----------
const qs=new URLSearchParams(location.search);
const SB_URL=qs.get('sburl')||SUPABASE_URL,SB_KEY=qs.get('sbkey')||SUPABASE_ANON_KEY;
const MY_ID=Math.random().toString(36).slice(2,10),NEAR=400,SEND_MS=250;
const MY_NAME=qs.get('name')||'旅人'+Math.floor(Math.random()*900+100);
let ch=null,online=false,netMsg='オフライン',clips=[],sendT=0;const remotes=new Map();
function label(text){const c=document.createElement('canvas');c.width=256;c.height=64;const g=c.getContext('2d');g.font='bold 30px sans-serif';g.textAlign='center';g.fillStyle='#fff';g.strokeStyle='#4a3a52';g.lineWidth=6;g.strokeText(text,128,42);g.fillText(text,128,42);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false,fog:false}));sp.scale.set(2,.5,1);sp.position.y=2.3;sp.renderOrder=10;return sp;}
function addRemote(id,name){if(!model||remotes.has(id))return;const holder=new THREE.Group(),m=SkeletonUtils.clone(model);holder.add(m,label(name));scene.add(holder);
  const mixer=new THREE.AnimationMixer(m),acts={};clips.forEach(c=>acts[c.name]=mixer.clipAction(c));remotes.set(id,{holder,mixer,acts,cur:null,tx:0,ty:0,tz:0,yaw:0,a:0,init:false});}
function updRemotes(dt){const k=Math.min(1,dt*10);for(const r of remotes.values()){const h=r.holder;
  if(!r.init){h.position.set(r.tx,r.ty,r.tz);h.rotation.y=r.yaw;r.init=true;}
  h.position.x+=(r.tx-h.position.x)*k;h.position.y+=(r.ty-h.position.y)*k;h.position.z+=(r.tz-h.position.z)*k;
  h.rotation.y+=((((r.yaw+(flip?Math.PI:0)-h.rotation.y)%(Math.PI*2))+Math.PI*3)%(Math.PI*2)-Math.PI)*k;
  const act=r.acts[r.a===2?'Climbing':'Run'];if(act){if(r.cur!==act){act.reset().fadeIn(.2).play();if(r.cur)r.cur.fadeOut(.2);r.cur=act;}act.timeScale=r.a===0?0:(r.a===3?.4:1);}
  r.mixer.update(dt);}}
function onState(d){if(!d||d.i===MY_ID||![d.x,d.y,d.z,d.r].every(Number.isFinite))return;
  const dx=d.x-P.pos.x,dz=d.z-P.pos.z;if(dx*dx+dz*dz>NEAR*NEAR)return;
  if(!remotes.has(d.i))addRemote(d.i,String(d.n||'旅人').slice(0,12));const o=remotes.get(d.i);
  if(o){o.tx=d.x;o.ty=d.y;o.tz=d.z;o.yaw=d.r;o.a=d.a|0;o.seen=performance.now();}}
function connect(){if(SB_URL.includes('YOUR-'))return;
  const opt={realtime:{params:{eventsPerSecond:10}}};if(qs.get('sbvsn'))opt.realtime.vsn=qs.get('sbvsn');
  const sb=createClient(SB_URL,SB_KEY,opt);netMsg='接続中…';
  ch=sb.channel('world',{config:{broadcast:{self:false,ack:false}}});
  ch.on('broadcast',{event:'s'},m=>onState(m.payload));
  ch.subscribe(st=>{online=st==='SUBSCRIBED';netMsg=online?'オンライン':(st==='TIMED_OUT'||st==='CHANNEL_ERROR')?'接続エラー(再試行中)':st==='CLOSED'?'切断':'接続中…';});}
connect();

// ---------- loop ----------
const clock=new THREE.Clock(),hud=document.getElementById('hud'),camTarget=new THREE.Vector3();let jumpLatch=false,fpsA=60,hudT=0;
streamChunks(0,0,true);
function frame(){
  const dt=Math.min(clock.getDelta(),.05);wind.value=clock.elapsedTime;
  let ix=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+stick.x,iz=(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0)+stick.y;
  const il=Math.hypot(ix,iz);if(il>1){ix/=il;iz/=il;}
  const sprint=keys.ShiftLeft?1.6:1,moving=il>.1;
  const fx=-Math.sin(camYaw),fz=-Math.cos(camYaw),rx=Math.cos(camYaw),rz=-Math.sin(camYaw);
  const dx=rx*ix-fx*iz,dz=rz*ix-fz*iz;
  const[gx,gz]=grad(P.pos.x,P.pos.z),slope=Math.hypot(gx,gz);
  if(moving&&P.grounded)P.yaw=Math.atan2(dx,dz);
  P.steep=P.grounded&&slope>1.25;
  if(P.grounded){
    const sp=(P.steep?2.2:8)*sprint,k=Math.min(1,dt*10);P.vel.x+=(dx*sp-P.vel.x)*k;P.vel.z+=(dz*sp-P.vel.z)*k;
    if(jumpHeld&&!jumpLatch){P.vel.y=9;P.grounded=false;jumpLatch=true;}
    if(!jumpHeld)jumpLatch=false;
  }else{
    P.gliding=jumpHeld&&P.vel.y<-1&&!jumpLatch;
    if(!jumpHeld)jumpLatch=false;
    if(P.gliding){P.vel.y=Math.max(P.vel.y-4*dt,-2.6);const fdx=moving?dx/il:Math.sin(P.yaw),fdz=moving?dz/il:Math.cos(P.yaw);
      P.vel.x+=(fdx*17-P.vel.x)*dt*1.5;P.vel.z+=(fdz*17-P.vel.z)*dt*1.5;P.yaw=Math.atan2(P.vel.x,P.vel.z);}
    else{P.vel.y-=24*dt;P.vel.x+=(dx*6-P.vel.x)*dt*2;P.vel.z+=(dz*6-P.vel.z)*dt*2;}
  }
  P.pos.addScaledVector(P.vel,dt);
  const gh=height(P.pos.x,P.pos.z);
  if(P.grounded){if(gh<P.pos.y-.7){P.grounded=false;P.vel.y=0;}else P.pos.y=gh;}
  else if(P.pos.y<=gh){P.pos.y=gh;P.vel.y=0;P.grounded=true;P.gliding=false;}
  if(model){holder.position.copy(P.pos);
    const target=P.yaw+(flip?Math.PI:0);holder.rotation.y+=((((target-holder.rotation.y)%(Math.PI*2))+Math.PI*3)%(Math.PI*2)-Math.PI)*Math.min(1,dt*14);
    wings.visible=P.gliding;model.rotation.x=P.gliding?1.2:0;
    const hs=Math.hypot(P.vel.x,P.vel.z);
    if(!P.grounded)play('Run',.4);else if(P.steep&&moving)play('Climbing',1);else if(hs>.6)play('Run',hs/6);else play('Run',0);
    mixer.update(dt);}
  const cp=Math.cos(camPitch);let cy=P.pos.y+1.5+Math.sin(camPitch)*camDist;
  const cx=P.pos.x+Math.sin(camYaw)*cp*camDist,cz=P.pos.z+Math.cos(camYaw)*cp*camDist;cy=Math.max(cy,height(cx,cz)+1);
  camera.position.set(cx,cy,cz);camera.lookAt(P.pos.x,P.pos.y+1.3,P.pos.z);
  sky.position.copy(camera.position);
  sun.position.set(Math.round(P.pos.x+SUN_DIR.x*150),P.pos.y+SUN_DIR.y*150,Math.round(P.pos.z+SUN_DIR.z*150));sun.target.position.copy(P.pos);
  streamChunks(P.pos.x,P.pos.z,false);
  fpsA+=(1/Math.max(dt,1e-3)-fpsA)*.05;
  if((hudT+=dt)>.3){hudT=0;hud.innerHTML=`SKYREALM ${fpsA|0}fps 高度 ${P.pos.y.toFixed(0)}m ${loadMsg} ${netMsg}${remotes.size?` 周囲${remotes.size}人`:''}<br>WASD移動 / Shift走る / Space ジャンプ(空中で長押し=滑空) / ドラッグで視点`;}
  updRemotes(dt);
  const nowMs=performance.now();
  for(const[id,r]of remotes)if(nowMs-(r.seen||nowMs)>4000){scene.remove(r.holder);remotes.delete(id);}   // 4秒音沙汰なしで退場
  if(nowMs-sendT>SEND_MS&&online){sendT=nowMs;const a=P.gliding?3:(P.steep&&moving)?2:(Math.hypot(P.vel.x,P.vel.z)>.6||!P.grounded)?1:0;
    ch.send({type:'broadcast',event:'s',payload:{i:MY_ID,n:MY_NAME,x:+P.pos.x.toFixed(2),y:+P.pos.y.toFixed(2),z:+P.pos.z.toFixed(2),r:+P.yaw.toFixed(2),a}});}
  renderer.render(scene,camera);requestAnimationFrame(frame);
}
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
frame();
{const b=document.getElementById('boot');b.style.opacity=0;setTimeout(()=>b.remove(),900);}
