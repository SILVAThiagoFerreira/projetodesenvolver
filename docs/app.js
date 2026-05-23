const gravity = 9.80665;
let holes = [];
let results = [];
let contour = [];
let currentRadius = NaN;
let viewBounds = null;
let isDragging = false;
let dragStart = null;
const tileCache = new Map();
let charts = [];
let reportHtml = "";

const V = {
  green: "#007E7A",
  yellow: "#ECB11F",
  gray: "#747678",
  dark: "#555555",
  black: "#303030",
  border: "#E1E7E5",
  polyStroke: "#003C46",
};

const fields = [
  ["litologia","text","ITABIRITO"],["densidade_litologica_g_cm3","number","2.7"],["diametro_furo_pol","number","6.5"],
  ["profundidade_m","number","12"],["afastamento_m","number","4"],["espacamento_m","number","5"],
  ["tampao_real_m","number","3.5"],["carga_maxima_espera_kg","number","175"],["massa_desmontada_kt","number","10"],
  ["razao_carga","number","0.75"]
];

function n(v){const x=Number(String(v ?? "").replace(",",".")); return Number.isFinite(x)?x:NaN}
function fmt(v,d=2){return Number.isFinite(v)?Number(v).toFixed(d):"-"}
function percentile(a,p){const x=a.filter(Number.isFinite).sort((u,v)=>u-v); if(!x.length)return NaN; const i=(x.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return x[lo]+(x[hi]-x[lo])*(i-lo)}
function mean(a){const x=a.filter(Number.isFinite); return x.length?x.reduce((s,v)=>s+v,0)/x.length:NaN}
function terrockLmax(k,cl,ds,angle){
  return (k*k/gravity)*Math.pow(cl/ds,1.3)*Math.pow(Math.sin(angle*Math.PI/180),2);
}
function csv(rows){const keys=Object.keys(rows[0]||{}); return [keys.join(";"),...rows.map(r=>keys.map(k=>String(r[k]??"").replaceAll(";"," ")).join(";"))].join("\n")}
function download(name,content,type){const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click()}

function addHole(seed={}){
  const row = Object.fromEntries(fields.map(([key,,def]) => [key, seed[key] ?? def]));
  holes.push(row);
  renderHoles();
}

function emptyHole(){
  return Object.fromEntries(fields.map(([key]) => [key, ""]));
}

function renderHoles(){
  const tbody = document.querySelector("#holesTable tbody");
  tbody.innerHTML = "";
  holes.forEach((hole,idx)=>{
    const tr=document.createElement("tr");
    fields.forEach(([key,type])=>{
      const td=document.createElement("td");
      const input=document.createElement("input");
      input.type=type; input.value=hole[key] ?? ""; input.dataset.idx=idx; input.dataset.key=key;
      input.className="hole-input";
      if(key==="litologia") input.classList.add("lito");
      if(type==="number") input.classList.add("numeric");
      input.oninput=()=>{holes[idx][key]=input.value; run(true)};
      td.appendChild(input); tr.appendChild(td);
    });
    const td=document.createElement("td"); const btn=document.createElement("button"); btn.textContent="Remover"; btn.className="remove";
    btn.onclick=()=>{holes.splice(idx,1); renderHoles()}; td.appendChild(btn); tr.appendChild(td); tbody.appendChild(tr);
  });
}

function validateAndCompute(h,k,angle){
  const r={...h};
  ["densidade_litologica_g_cm3","diametro_furo_pol","profundidade_m","afastamento_m","espacamento_m","tampao_real_m","carga_maxima_espera_kg","massa_desmontada_kt","razao_carga"].forEach(c=>r[c]=n(r[c]));
  const errors=[];
  if(!r.litologia) errors.push("litologia vazia");
  if(!(r.profundidade_m>0)) errors.push("profundidade invalida");
  if(!(r.tampao_real_m>0)) errors.push("tampao real invalido");
  if(!(r.tampao_real_m<r.profundidade_m)) errors.push("tampao deve ser menor que profundidade");
  if(!(r.carga_maxima_espera_kg>0)) errors.push("CME invalida");
  if(!(r.afastamento_m>0)) errors.push("afastamento invalido");
  if(!(r.espacamento_m>0)) errors.push("espacamento invalido");
  if(!(angle>0 && angle<90)) errors.push("angulo invalido");
  r.validation_errors=errors.join("; ");
  r.validation_status=errors.length?"invalid":"valid";
  if(!errors.length){
    r.coluna_carregada_m=r.profundidade_m-r.tampao_real_m;
    r.carga_linear_kg_m=r.carga_maxima_espera_kg/r.coluna_carregada_m;
    r.area_malha_m2=r.afastamento_m*r.espacamento_m;
    r.volume_estimado_m3=r.area_malha_m2*r.profundidade_m;
    r.massa_estimativa_t=r.volume_estimado_m3*r.densidade_litologica_g_cm3;
    r.massa_desmontada_t=r.massa_desmontada_kt*1000;
    r.razao_carga_calculada_kg_t=r.carga_maxima_espera_kg/r.massa_desmontada_t;
    r.razao_tampao_profundidade=r.tampao_real_m/r.profundidade_m;
    r.energia_relativa=r.carga_maxima_espera_kg/r.tampao_real_m;
    r.tampao_efetivo_m=r.tampao_real_m;
    r.indice_confinamento=r.tampao_efetivo_m/r.carga_linear_kg_m;
    r.lmax_previsto_m=terrockLmax(k,r.carga_linear_kg_m,r.tampao_efetivo_m,angle);
    r.raio_pessoas_m=r.lmax_previsto_m*n(document.getElementById("peopleFactor").value);
    r.raio_equipamentos_m=r.lmax_previsto_m*n(document.getElementById("equipmentFactor").value);
  }
  return r;
}

function table(rows, keys, limit=100){
  if(!rows.length) return "<p>Sem dados calculados.</p>";
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${keys.map(k=>`<th>${k}</th>`).join("")}</tr></thead><tbody>${rows.slice(0,limit).map(r=>`<tr>${keys.map(k=>{
    const isNumber = Number.isFinite(r[k]);
    const value = isNumber ? fmt(r[k]) : String(r[k] ?? "");
    return `<td class="${isNumber ? "is-number" : ""}">${value}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function inverseRows(valid,k,angle,target,peopleFactor){
  const allowed=target/peopleFactor;
  return valid.map(r=>{
    const ratio=allowed/r.lmax_previsto_m;
    const tampaoNec=r.tampao_real_m/Math.pow(ratio,1/1.3);
    const clNec=r.carga_linear_kg_m*Math.pow(ratio,1/1.3);
    const cargaNec=clNec*r.coluna_carregada_m;
    return {
      litologia:r.litologia, lmax_atual_m:r.lmax_previsto_m, raio_atual_pessoas_m:r.raio_pessoas_m,
      raio_alvo_pessoas_m:target, lmax_permitido_m:allowed, tampao_atual_m:r.tampao_real_m,
      tampao_necessario_m:tampaoNec, aumento_tampao_m:Math.max(0,tampaoNec-r.tampao_real_m),
      cme_atual_kg:r.carga_maxima_espera_kg, cme_necessaria_kg:cargaNec,
      reducao_cme_pct:Math.max(0,(1-cargaNec/r.carga_maxima_espera_kg)*100),
      alerta:tampaoNec<r.profundidade_m && cargaNec>0 ? "viavel como triagem" : "requer redesenho tecnico"
    };
  });
}

function pointKey(point, eps=0.001){
  return `${Math.round(point[0] / eps)}:${Math.round(point[1] / eps)}`;
}

function collectSegmentComponents(segments){
  const pointToSegments = new Map();
  segments.forEach((segment, idx)=>{
    segment.forEach(pt=>{
      const key = pointKey(pt);
      if(!pointToSegments.has(key)) pointToSegments.set(key, []);
      pointToSegments.get(key).push(idx);
    });
  });

  const seen = new Array(segments.length).fill(false);
  const components = [];
  for(let start=0; start<segments.length; start++){
    if(seen[start]) continue;
    const stack = [start];
    seen[start] = true;
    const component = [];
    while(stack.length){
      const idx = stack.pop();
      component.push(idx);
      segments[idx].forEach(pt=>{
        const neighbors = pointToSegments.get(pointKey(pt)) || [];
        neighbors.forEach(next=>{
          if(!seen[next]){
            seen[next] = true;
            stack.push(next);
          }
        });
      });
    }
    components.push(component);
  }
  return components;
}

function chainClosedComponent(segments, indices){
  if(!indices.length) return null;
  const adjacency = new Map();
  const addPoint = pt=>{
    const key = pointKey(pt);
    if(!adjacency.has(key)) adjacency.set(key, {point: pt, neighbors: new Set()});
    return key;
  };

  indices.forEach(idx=>{
    const [a,b] = segments[idx];
    const ka = addPoint(a);
    const kb = addPoint(b);
    adjacency.get(ka).neighbors.add(kb);
    adjacency.get(kb).neighbors.add(ka);
  });

  if(adjacency.size < 3) return null;
  for(const node of adjacency.values()){
    if(node.neighbors.size !== 2) return null;
  }

  const startKey = adjacency.keys().next().value;
  const startNode = adjacency.get(startKey);
  const startNeighbors = [...startNode.neighbors];
  if(startNeighbors.length !== 2) return null;

  const path = [startNode.point];
  let prevKey = startKey;
  let currentKey = startNeighbors[0];
  path.push(adjacency.get(currentKey).point);
  let edgesUsed = 1;

  while(edgesUsed < indices.length){
    const currentNode = adjacency.get(currentKey);
    const neighbors = [...currentNode.neighbors];
    const nextKey = neighbors[0] === prevKey ? neighbors[1] : neighbors[0];
    if(nextKey === undefined) return null;
    edgesUsed += 1;
    if(nextKey === startKey){
      return edgesUsed === indices.length ? path : null;
    }
    path.push(adjacency.get(nextKey).point);
    prevKey = currentKey;
    currentKey = nextKey;
  }

  return null;
}

function parseDxf(text,scale){
  const lines=text.replace(/\r/g,"").split("\n").map(s=>s.trim());
  const segments=[];
  const polylines=[];
  let currentType = null;
  let lineState = null;
  let polylineState = null;
  let index = 0;

  const nextToken = ()=>{
    while(index < lines.length && lines[index] === "") index += 1;
    return index < lines.length ? lines[index++] : null;
  };

  const flushEntity = ()=>{
    if(currentType === "LINE" && lineState && Number.isFinite(lineState.x1) && Number.isFinite(lineState.y1) && Number.isFinite(lineState.x2) && Number.isFinite(lineState.y2)){
      segments.push([[lineState.x1,lineState.y1],[lineState.x2,lineState.y2]]);
    }else if(currentType === "LWPOLYLINE" && polylineState && polylineState.closed && polylineState.pts.length >= 3){
      polylines.push({pts: polylineState.pts, closed: polylineState.closed});
    }
    currentType = null;
    lineState = null;
    polylineState = null;
  };

  while(index < lines.length){
    const code = nextToken();
    if(code === null) break;
    const value = nextToken();
    if(value === null) break;
    if(code === "0"){
      flushEntity();
      currentType = value;
      if(currentType === "LINE"){
        lineState = {x1:NaN,y1:NaN,x2:NaN,y2:NaN};
      }else if(currentType === "LWPOLYLINE"){
        polylineState = {pts:[], closed:false, pendingX:null};
      }
      continue;
    }
    if(currentType === "LINE" && lineState){
      if(code === "10") lineState.x1 = n(value) * scale;
      else if(code === "20") lineState.y1 = n(value) * scale;
      else if(code === "11") lineState.x2 = n(value) * scale;
      else if(code === "21") lineState.y2 = n(value) * scale;
      continue;
    }
    if(currentType === "LWPOLYLINE" && polylineState){
      if(code === "70") polylineState.closed = (Number(value) & 1) === 1;
      else if(code === "10") polylineState.pendingX = n(value) * scale;
      else if(code === "20" && Number.isFinite(polylineState.pendingX)){
        polylineState.pts.push([polylineState.pendingX, n(value) * scale]);
        polylineState.pendingX = null;
      }
    }
  }
  flushEntity();

  const lineContours = collectSegmentComponents(segments)
    .map(component=>chainClosedComponent(segments, component))
    .filter(pts=>pts && pts.length >= 3)
    .map(pts=>({pts,stats:polygonStats(pts)}))
    .filter(p=>p.stats && p.stats.area_m2>5 && p.stats.largura_m>1 && p.stats.altura_m>1);

  const polylineContours=polylines
    .map(p=>({pts:p.pts,stats:polygonStats(p.pts)}))
    .filter(p=>p.stats && p.stats.area_m2>5 && p.stats.largura_m>1 && p.stats.altura_m>1);

  const candidates=[...lineContours, ...polylineContours];
  candidates.sort((a,b)=>b.stats.area_m2-a.stats.area_m2);
  return candidates[0]?.pts ?? [];
}

function polygonStats(pts){
  if(pts.length<2) return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,per=0,area=0;
  pts.forEach(([x,y],i)=>{minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); const [x2,y2]=pts[(i+1)%pts.length]; per+=Math.hypot(x2-x,y2-y); area+=x*y2-x2*y});
  return {pontos:pts.length,min_x:minX,min_y:minY,max_x:maxX,max_y:maxY,largura_m:maxX-minX,altura_m:maxY-minY,perimetro_m:per,area_m2:Math.abs(area/2)};
}

function centroid(pts){
  if(!pts.length) return [0,0];
  const st=polygonStats(pts);
  return [(st.min_x+st.max_x)/2,(st.min_y+st.max_y)/2];
}

function drawMap(){
  const canvas=document.getElementById("mapCanvas"), ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle="#f7faf9"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const [cx,cy]=centroid(contour), radius=Number.isFinite(currentRadius)?currentRadius:0, pad=42;
  const baseBounds = getInitialBounds();
  if(!viewBounds) viewBounds = baseBounds;
  let {minX,maxX,minY,maxY}=viewBounds;
  const sx=(canvas.width-2*pad)/(maxX-minX||1), sy=(canvas.height-2*pad)/(maxY-minY||1), s=Math.min(sx,sy);
  const px=x=>pad+(x-minX)*s, py=y=>canvas.height-pad-(y-minY)*s;
  const wx=screenX=>minX+(screenX-pad)/s, wy=screenY=>minY+(canvas.height-pad-screenY)/s;
  if(document.getElementById("showSatellite").checked) drawSatellite(ctx,{minX,maxX,minY,maxY},px,py);
  if(!contour.length) return;
  if(radius>0 && document.getElementById("showRadius").checked){
    ctx.beginPath(); ctx.arc(px(cx),py(cy),radius*s,0,Math.PI*2);
    ctx.fillStyle="rgba(236,177,31,.12)"; ctx.fill(); ctx.strokeStyle=V.yellow; ctx.lineWidth=2.5; ctx.setLineDash([9,6]); ctx.stroke(); ctx.setLineDash([]);
    const eq=n(document.getElementById("equipmentFactor").value), pe=n(document.getElementById("peopleFactor").value), equipmentRadius=radius*(eq/pe);
    if(Number.isFinite(equipmentRadius)&&equipmentRadius>0){
      ctx.beginPath(); ctx.arc(px(cx),py(cy),equipmentRadius*s,0,Math.PI*2);
      ctx.fillStyle="rgba(0,126,122,.11)"; ctx.fill(); ctx.strokeStyle=V.green; ctx.lineWidth=2; ctx.stroke();
    }
  }
  ctx.beginPath(); contour.forEach(([x,y],i)=>{if(i)ctx.lineTo(px(x),py(y)); else ctx.moveTo(px(x),py(y))}); ctx.closePath();
  ctx.fillStyle="rgba(0,60,70,.18)"; ctx.fill(); ctx.strokeStyle=V.polyStroke; ctx.lineWidth=3; ctx.stroke();
  ctx.beginPath(); ctx.arc(px(cx),py(cy),4,0,Math.PI*2); ctx.fillStyle=V.polyStroke; ctx.fill();
  ctx.fillStyle=V.black; ctx.font="600 12px Arial"; ctx.fillText(`Raio pessoas: ${fmt(currentRadius)} m`, px(cx)+10, py(cy)-10);
  ctx.font="12px Arial"; ctx.fillText(`Poligonal do desmonte`, px(cx)+10, py(cy)+8);
  drawMap.lastTransform={px,py,wx,wy,s,pad};
}

function drawSatellite(ctx,bounds,px,py){
  const zone=n(document.getElementById("utmZone").value), hemi=document.getElementById("utmHemisphere").value;
  if(!(zone>=1&&zone<=60)) return;
  const corners=[
    utmToLatLon(bounds.minX,bounds.minY,zone,hemi),
    utmToLatLon(bounds.maxX,bounds.maxY,zone,hemi)
  ];
  const z=estimateZoom(bounds);
  const t1=lonLatToTile(corners[0].lon,corners[1].lat,z), t2=lonLatToTile(corners[1].lon,corners[0].lat,z);
  const minTx=Math.max(0,Math.min(t1.x,t2.x)-1), maxTx=Math.min(2**z-1,Math.max(t1.x,t2.x)+1);
  const minTy=Math.max(0,Math.min(t1.y,t2.y)-1), maxTy=Math.min(2**z-1,Math.max(t1.y,t2.y)+1);
  for(let x=minTx;x<=maxTx;x++){
    for(let y=minTy;y<=maxTy;y++){
      const img=getTile(z,x,y);
      if(!img.complete) continue;
      const nw=tileToLonLat(x,y,z), se=tileToLonLat(x+1,y+1,z);
      const p1=lonLatToUtm(nw.lon,nw.lat,zone,hemi), p2=lonLatToUtm(se.lon,se.lat,zone,hemi);
      ctx.globalAlpha=.8;
      ctx.drawImage(img,px(p1.easting),py(p1.northing),px(p2.easting)-px(p1.easting),py(p2.northing)-py(p1.northing));
      ctx.globalAlpha=1;
    }
  }
}

function getTile(z,x,y){
  const key=`${z}/${x}/${y}`;
  if(tileCache.has(key)) return tileCache.get(key);
  const img=new Image();
  img.crossOrigin="anonymous";
  img.onload=drawMap;
  img.src=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  tileCache.set(key,img);
  return img;
}

function estimateZoom(bounds){
  const width=Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY);
  if(width<250) return 18;
  if(width<500) return 17;
  if(width<1200) return 16;
  if(width<2500) return 15;
  return 14;
}

function lonLatToTile(lon,lat,z){
  const latRad=lat*Math.PI/180, n=2**z;
  return {x:Math.floor((lon+180)/360*n),y:Math.floor((1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2*n)};
}

function tileToLonLat(x,y,z){
  const n=2**z, lon=x/n*360-180, lat=Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
  return {lon,lat};
}

function utmToLatLon(easting,northing,zone,hemisphere){
  const a=6378137, e=0.081819191, e1sq=0.006739497, k0=0.9996;
  const x=easting-500000; let y=northing;
  if(hemisphere==="S") y-=10000000;
  const m=y/k0, mu=m/(a*(1-e*e/4-3*e**4/64-5*e**6/256));
  const e1=(1-Math.sqrt(1-e*e))/(1+Math.sqrt(1-e*e));
  const j1=3*e1/2-27*e1**3/32, j2=21*e1*e1/16-55*e1**4/32, j3=151*e1**3/96, j4=1097*e1**4/512;
  const fp=mu+j1*Math.sin(2*mu)+j2*Math.sin(4*mu)+j3*Math.sin(6*mu)+j4*Math.sin(8*mu);
  const c1=e1sq*Math.cos(fp)**2, t1=Math.tan(fp)**2, r1=a*(1-e*e)/Math.pow(1-e*e*Math.sin(fp)**2,1.5), n1=a/Math.sqrt(1-e*e*Math.sin(fp)**2), d=x/(n1*k0);
  const q1=n1*Math.tan(fp)/r1, q2=d*d/2, q3=(5+3*t1+10*c1-4*c1*c1-9*e1sq)*d**4/24, q4=(61+90*t1+298*c1+45*t1*t1-252*e1sq-3*c1*c1)*d**6/720;
  const lat=fp-q1*(q2-q3+q4);
  const q5=d, q6=(1+2*t1+c1)*d**3/6, q7=(5-2*c1+28*t1-3*c1*c1+8*e1sq+24*t1*t1)*d**5/120;
  const lon0=(zone-1)*6-180+3;
  const lon=lon0+(q5-q6+q7)/Math.cos(fp)*180/Math.PI;
  return {lat:lat*180/Math.PI,lon};
}

function lonLatToUtm(lon,lat,zone,hemisphere){
  const a=6378137, eccSquared=0.00669438, k0=0.9996, latRad=lat*Math.PI/180, lonRad=lon*Math.PI/180, lonOrigin=(zone-1)*6-180+3, lonOriginRad=lonOrigin*Math.PI/180;
  const eccPrimeSquared=eccSquared/(1-eccSquared), n1=a/Math.sqrt(1-eccSquared*Math.sin(latRad)**2), t=Math.tan(latRad)**2, c=eccPrimeSquared*Math.cos(latRad)**2, A=Math.cos(latRad)*(lonRad-lonOriginRad);
  const M=a*((1-eccSquared/4-3*eccSquared**2/64-5*eccSquared**3/256)*latRad-(3*eccSquared/8+3*eccSquared**2/32+45*eccSquared**3/1024)*Math.sin(2*latRad)+(15*eccSquared**2/256+45*eccSquared**3/1024)*Math.sin(4*latRad)-(35*eccSquared**3/3072)*Math.sin(6*latRad));
  let easting=k0*n1*(A+(1-t+c)*A**3/6+(5-18*t+t*t+72*c-58*eccPrimeSquared)*A**5/120)+500000;
  let northing=k0*(M+n1*Math.tan(latRad)*(A*A/2+(5-t+9*c+4*c*c)*A**4/24+(61-58*t+t*t+600*c-330*eccPrimeSquared)*A**6/720));
  if(hemisphere==="S" && northing<0) northing+=10000000;
  return {easting,northing};
}

function getInitialBounds(){
  const cst=polygonStats(contour), [cx,cy]=centroid(contour), radius=Number.isFinite(currentRadius)?currentRadius:0;
  if(cst){
    const margin=Math.max(40,radius*1.15);
    return {minX:Math.min(cst.min_x,cx-margin),maxX:Math.max(cst.max_x,cx+margin),minY:Math.min(cst.min_y,cy-margin),maxY:Math.max(cst.max_y,cy+margin)};
  }
  return {minX:0,maxX:100,minY:0,maxY:100};
}

function zoomView(factor,screenX=null,screenY=null){
  if(!viewBounds) viewBounds=getInitialBounds();
  const canvas=document.getElementById("mapCanvas"), t=drawMap.lastTransform;
  const cx=t&&screenX!==null?t.wx(screenX):(viewBounds.minX+viewBounds.maxX)/2;
  const cy=t&&screenY!==null?t.wy(screenY):(viewBounds.minY+viewBounds.maxY)/2;
  const w=(viewBounds.maxX-viewBounds.minX)*factor, h=(viewBounds.maxY-viewBounds.minY)*factor;
  viewBounds={minX:cx-w/2,maxX:cx+w/2,minY:cy-h/2,maxY:cy+h/2};
  drawMap();
}

function panView(dx,dy){
  const t=drawMap.lastTransform; if(!t||!viewBounds) return;
  const worldDx=-dx/t.s, worldDy=dy/t.s;
  viewBounds={minX:viewBounds.minX+worldDx,maxX:viewBounds.maxX+worldDx,minY:viewBounds.minY+worldDy,maxY:viewBounds.maxY+worldDy};
  drawMap();
}

function renderSpatialStats(){
  const dxf=polygonStats(contour);
  const items=[];
  if(dxf){items.push(["Área DXF",`${fmt(dxf.area_m2)} m²`],["Perímetro DXF",`${fmt(dxf.perimetro_m)} m`],["Largura x altura",`${fmt(dxf.largura_m)} x ${fmt(dxf.altura_m)} m`],["Pontos DXF",dxf.pontos]);}
  document.getElementById("spatialStats").innerHTML=items.map(([k,v])=>`<div><strong>${k}</strong><span>${v}</span></div>`).join("");
}

function run(silent=false){
  const k=n(document.getElementById("kValue").value), angle=n(document.getElementById("angleValue").value), people=n(document.getElementById("peopleFactor").value), equipment=n(document.getElementById("equipmentFactor").value);
  results=holes.map(h=>validateAndCompute(h,k,angle));
  const valid=results.filter(r=>r.validation_status==="valid");
  const lmax=valid.map(r=>r.lmax_previsto_m);
  const mode=document.getElementById("referenceMode").value;
  const ref=lmax.length ? (mode==="median"?percentile(lmax,.5):mode==="p95"?percentile(lmax,.95):mode==="p90"?percentile(lmax,.90):mode==="mean"?mean(lmax):Math.max(...lmax)) : NaN;
  currentRadius=Number.isFinite(ref) ? ref*people : NaN;
  document.getElementById("holeCount").textContent=valid.length;
  document.getElementById("lmaxRef").textContent=`${fmt(ref)} m`;
  document.getElementById("peopleRadius").textContent=`${fmt(currentRadius)} m`;
  document.getElementById("equipmentRadius").textContent=`${fmt(Number.isFinite(ref)?ref*equipment:NaN)} m`;
  updateEquationPanel(valid,k,angle,ref,people,equipment,mode);
  const resultKeys=["litologia","coluna_carregada_m","carga_linear_kg_m","massa_desmontada_kt","razao_carga_calculada_kg_t","razao_tampao_profundidade","lmax_previsto_m","raio_equipamentos_m","raio_pessoas_m","validation_status","validation_errors"];
  document.getElementById("resultsTable").innerHTML=table(results,resultKeys);
  const inverse=inverseRows(valid,k,angle,n(document.getElementById("targetRadius").value),people);
  document.getElementById("inverseTable").innerHTML=table(inverse,["litologia","lmax_atual_m","raio_atual_pessoas_m","lmax_permitido_m","tampao_necessario_m","aumento_tampao_m","cme_necessaria_kg","reducao_cme_pct","alerta"]);
  renderTechnicalNotes(valid,ref,people,equipment);
  drawMap();
  charts.forEach(c=>c.destroy());
  charts=[
    new Chart(document.getElementById("lmaxChart"),{type:"bar",data:{labels:valid.map((r,i)=>r.litologia || `Condição ${i+1}`),datasets:[{label:"Lmax previsto (m)",data:lmax,backgroundColor:V.green,borderColor:V.green,borderRadius:10,borderSkipped:false,maxBarThickness:52}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:4,right:8,bottom:0,left:8}},plugins:{legend:{display:false},title:{display:true,text:"Lmax previsto por condição",color:V.dark,font:{family:"Arial",size:14,weight:"700"},padding:{bottom:12}},tooltip:{backgroundColor:V.black,titleColor:"#fff",bodyColor:"#fff",padding:12,cornerRadius:10,displayColors:false}},scales:{x:{grid:{display:false},ticks:{color:V.dark,font:{family:"Arial",size:12,weight:"600"},maxRotation:0,autoSkip:false}},y:{beginAtZero:true,grid:{color:V.border,drawBorder:false},ticks:{color:V.dark,font:{family:"Arial",size:12}},title:{display:true,text:"m",color:V.gray,font:{family:"Arial",size:12,weight:"700"}}}}}}),
  ];
  reportHtml=`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relatório Terrock Flyrock</title>
  <style>
    :root{--vale-green:#007E7A;--vale-yellow:#ECB11F;--vale-gray:#747678;--vale-dark-gray:#555555;--vale-black-gray:#303030;--vale-bg:#F7F9F8;--vale-surface:#FFFFFF;--vale-border:#E1E7E5;--vale-soft-yellow:#FFF6D8;--vale-soft-green:#E6F2F1;--shadow:0 14px 28px rgba(48,48,48,.07)}
    *{box-sizing:border-box}
    body{margin:0;padding:24px;background:var(--vale-bg);color:var(--vale-dark-gray);font-family:Arial,Helvetica,sans-serif;line-height:1.5}
    .shell{max-width:1120px;margin:0 auto;background:var(--vale-surface);border:1px solid var(--vale-border);border-radius:18px;overflow:hidden;box-shadow:var(--shadow)}
    .hero{padding:22px 24px;background:linear-gradient(135deg,#005e5a 0%,var(--vale-green) 72%,#006865 100%);color:#fff}
    .hero h1{margin:0 0 8px;font-size:26px;line-height:1.15;letter-spacing:-.03em}
    .hero p{margin:0;color:rgba(255,255,255,.84);font-size:14px}
    .section{padding:20px 24px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:0 24px 4px}
    .card{padding:14px;border:1px solid var(--vale-border);border-radius:14px;background:#fff;box-shadow:0 8px 18px rgba(48,48,48,.04)}
    .card span{display:block;color:var(--vale-gray);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .card strong{display:block;margin-top:4px;color:var(--vale-green);font-size:24px;line-height:1.05}
    h2{margin:0 0 12px;font-size:18px;color:var(--vale-black-gray)}
    .table-wrap{overflow:auto;border:1px solid var(--vale-border);border-radius:14px;background:#fff}
    table{width:100%;border-collapse:separate;border-spacing:0;background:#fff}
    th,td{padding:10px 12px;border-bottom:1px solid #eef3f1;border-right:1px solid #eef3f1;font-size:12.5px;text-align:left;vertical-align:middle}
    th:last-child,td:last-child{border-right:0}
    thead th{position:sticky;top:0;background:#f2f5f4;color:var(--vale-dark-gray);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
    tbody tr:nth-child(even){background:#fbfcfc}
    tbody tr:hover{background:#f4f8f7}
    tbody tr:last-child td{border-bottom:0}
    td.is-number{font-variant-numeric:tabular-nums;text-align:right}
    .notice{margin:0 24px 24px;padding:14px 16px;background:linear-gradient(180deg,#fff8db 0%,#fffef5 100%);border:1px solid rgba(236,177,31,.58);border-left:4px solid var(--vale-yellow);border-radius:14px;color:#6d5a1e}
    @media (max-width:900px){.cards{grid-template-columns:1fr 1fr}.section,.hero{padding-left:18px;padding-right:18px}}
    @media (max-width:620px){body{padding:12px}.cards{grid-template-columns:1fr}.hero h1{font-size:22px}}
  </style>
</head>
<body>
  <div class="shell">
    <header class="hero">
      <h1>Relatório Terrock Flyrock</h1>
      <p>Ferramenta de apoio técnico; não substitui responsável técnico habilitado.</p>
    </header>
    <div class="cards">
      <div class="card"><span>Desmonte</span><strong>${document.getElementById("blastName").value}</strong></div>
      <div class="card"><span>K</span><strong>${fmt(k,2)}</strong></div>
      <div class="card"><span>Lmax referência</span><strong>${fmt(ref)} m</strong></div>
      <div class="card"><span>Raio pessoas</span><strong>${fmt(ref*people)} m</strong></div>
    </div>
    <section class="section">
      <h2>Resultados</h2>
      ${table(results,resultKeys)}
    </section>
    <section class="section">
      <h2>Desenho inverso</h2>
      ${table(inverse,["litologia","lmax_atual_m","raio_atual_pessoas_m","lmax_permitido_m","tampao_necessario_m","cme_necessaria_kg","alerta"])}
    </section>
    <div class="notice">O relatório preserva a lógica técnica do modelo e deve ser revisado por profissional habilitado antes de qualquer decisão operacional.</div>
  </div>
</body>
</html>`;
  document.getElementById("downloadCsv").disabled=false; document.getElementById("downloadReport").disabled=false;
  document.getElementById("downloadKml").disabled=!contour.length;
  document.getElementById("openEarth").disabled=!contour.length;
}

function contourLonLat(){
  const zone=n(document.getElementById("utmZone").value), hemi=document.getElementById("utmHemisphere").value;
  return contour.map(([x,y])=>utmToLatLon(x,y,zone,hemi));
}

function circleLonLat(radius,steps=96){
  const [cx,cy]=centroid(contour), zone=n(document.getElementById("utmZone").value), hemi=document.getElementById("utmHemisphere").value;
  const pts=[];
  for(let i=0;i<=steps;i++){
    const a=i/steps*Math.PI*2;
    pts.push(utmToLatLon(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,zone,hemi));
  }
  return pts;
}

function kmlCoords(points){
  return points.map(p=>`${p.lon},${p.lat},0`).join(" ");
}

function buildKml(){
  const people=Number.isFinite(currentRadius)?circleLonLat(currentRadius):[];
  const eqFactor=n(document.getElementById("equipmentFactor").value), peopleFactor=n(document.getElementById("peopleFactor").value);
  const equipment=Number.isFinite(currentRadius)?circleLonLat(currentRadius*(eqFactor/peopleFactor)):[];
  const poly=contourLonLat();
  return `<?xml version="1.0" encoding="UTF-8"?>
 <kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Zona de Segurança Flyrock</name>
<Style id="poly"><LineStyle><color>ff463c00</color><width>3</width></LineStyle><PolyStyle><color>33463c00</color></PolyStyle></Style>
<Style id="people"><LineStyle><color>ff1fb1ec</color><width>3</width></LineStyle><PolyStyle><color>241fb1ec</color></PolyStyle></Style>
<Style id="equip"><LineStyle><color>ff7a7e00</color><width>2</width></LineStyle><PolyStyle><color>257a7e00</color></PolyStyle></Style>
<Placemark><name>Poligonal do desmonte</name><styleUrl>#poly</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(poly.concat(poly[0] ? [poly[0]] : []))}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Raio pessoas ${fmt(currentRadius)} m</name><styleUrl>#people</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(people)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Raio equipamentos</name><styleUrl>#equip</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(equipment)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
}

function updateEquationPanel(valid,k,angle,ref,people,equipment,mode){
  document.getElementById("equationText").textContent="Lmax = (K² / g) × (CL / DS)^1,3 × sen²(θ);  R = Lmax_ref × fator";
  if(!valid.length){
    document.getElementById("criticalHole").textContent="-";
    document.getElementById("equationSubstitution").textContent="Preencha pelo menos um furo válido.";
    return;
  }
  const critical=[...valid].sort((a,b)=>b.lmax_previsto_m-a.lmax_previsto_m)[0];
  const modeLabel={median:"mediana",max:"máximo",p95:"P95",p90:"P90",mean:"média"}[mode] || mode;
  document.getElementById("criticalHole").textContent=`${critical.litologia || "Desmonte"} · ${fmt(critical.lmax_previsto_m)} m`;
  document.getElementById("equationSubstitution").textContent=
    `Desmonte (${critical.litologia || "sem litologia"}): Lmax = (${fmt(k,2)}² / ${gravity}) × (${fmt(critical.carga_linear_kg_m,2)} / ${fmt(critical.tampao_efetivo_m,2)})^1,3 × sen²(${fmt(angle,1)}°) = ${fmt(critical.lmax_previsto_m)} m. `+
    `Referência ${modeLabel}: ${fmt(ref)} m; pessoas = ${fmt(ref)} × ${fmt(people,1)} = ${fmt(ref*people)} m; equipamentos = ${fmt(ref)} × ${fmt(equipment,1)} = ${fmt(ref*equipment)} m.`;
}

function renderTechnicalNotes(valid,ref,people,equipment){
  if(!valid.length){document.getElementById("technicalNotes").innerHTML=""; return;}
  const critical=[...valid].sort((a,b)=>b.lmax_previsto_m-a.lmax_previsto_m)[0];
  const avgBurden=mean(valid.map(r=>r.afastamento_m)), avgSpacing=mean(valid.map(r=>r.espacamento_m));
  const lowStemming=valid.filter(r=>r.razao_tampao_profundidade<0.25).length;
  const k=n(document.getElementById("kValue").value);
  const notes=[
    {tone:"critical",label:"Condição crítica",value:`${critical.litologia || "Desmonte"}: maior Lmax previsto (${fmt(critical.lmax_previsto_m)} m).`},
    {tone:"neutral",label:"Malha média",value:`Afastamento ${fmt(avgBurden)} m; espaçamento ${fmt(avgSpacing)} m.`},
    {tone:"warning",label:"K restringido",value:`K=${fmt(k,1)}. Lmax varia com K²; pequenas reduções em K reduzem fortemente o raio previsto.`},
    {tone:lowStemming?"warning":"success",label:"Confinamento",value:lowStemming?`${lowStemming} furo(s) com tampão/profundidade < 0,25.`:"Relação tampão/profundidade sem alerta crítico."}
  ];
  document.getElementById("technicalNotes").innerHTML=notes.map(n=>`<div class="insight-card insight-card--${n.tone}"><span class="insight-tag">${n.label}</span><span class="insight-copy">${n.value}</span></div>`).join("");
}

document.getElementById("addHoleBtn").onclick=()=>addHole(emptyHole());
function loadDefaultBlast(){
  // Exemplos reais extraídos da base processada a partir dos Excels e do relatório PDF.
  document.getElementById("blastName").value = "Exemplos da base";
  document.getElementById("kPreset").value = "14.2756";
  document.getElementById("kValue").value = "14.2756";
  document.getElementById("angleValue").value = "45";
  document.getElementById("peopleFactor").value = "4.6666666667";
  document.getElementById("equipmentFactor").value = "2";
  document.getElementById("targetRadius").value = "700";
  document.getElementById("referenceMode").value = "median";
  holes=[];
  addHole({litologia:"CE",densidade_litologica_g_cm3:3.5,diametro_furo_pol:5.75,profundidade_m:9.6,afastamento_m:2.2,espacamento_m:4.4,tampao_real_m:3.1,carga_maxima_espera_kg:124,massa_desmontada_kt:325.24800000000005,razao_carga:0.3812475403384494});
  addHole({litologia:"HF",densidade_litologica_g_cm3:3.5,diametro_furo_pol:5.75,profundidade_m:9.0,afastamento_m:2.2,espacamento_m:4.4,tampao_real_m:2.9,carga_maxima_espera_kg:120,massa_desmontada_kt:304.9200000000001,razao_carga:0.3935458480913025});
  addHole({litologia:"HC",densidade_litologica_g_cm3:3.5,diametro_furo_pol:5.75,profundidade_m:10.0,afastamento_m:2.2,espacamento_m:4.4,tampao_real_m:3,carga_maxima_espera_kg:123,massa_desmontada_kt:338.80000000000007,razao_carga:0.3630460448642266});
  run(true);
}

document.getElementById("sampleBtn").onclick=loadDefaultBlast;
document.getElementById("runBtn").onclick=run;
document.getElementById("downloadCsv").onclick=()=>download("base_furos_terrock.csv",csv(results),"text/csv;charset=utf-8");
document.getElementById("downloadReport").onclick=()=>download("relatorio_terrock_flyrock.html",reportHtml,"text/html;charset=utf-8");
document.getElementById("downloadKml").onclick=()=>download("zona_seguranca_google_earth.kml",buildKml(),"application/vnd.google-earth.kml+xml;charset=utf-8");
document.getElementById("openEarth").onclick=()=>{
  if(!contour.length) return;
  const [cx,cy]=centroid(contour), p=utmToLatLon(cx,cy,n(document.getElementById("utmZone").value),document.getElementById("utmHemisphere").value);
  window.open(`https://earth.google.com/web/@${p.lat},${p.lon},800a,1200d,35y,0h,0t,0r`,"_blank");
};
document.getElementById("dxfFile").onchange=async e=>{const file=e.target.files[0]; if(!file)return; contour=parseDxf(await file.text(),n(document.getElementById("dxfUnit").value)); viewBounds=getInitialBounds(); run(true); renderSpatialStats();};
document.getElementById("kPreset").addEventListener("input",e=>{
  if(e.target.value !== "custom") document.getElementById("kValue").value = e.target.value;
  run(true);
});
document.getElementById("kValue").addEventListener("input",()=>{
  document.getElementById("kPreset").value = "custom";
  run(true);
});
["angleValue","peopleFactor","equipmentFactor","targetRadius","referenceMode"].forEach(id=>document.getElementById(id).addEventListener("input",()=>run(true)));
["dxfUnit"].forEach(id=>document.getElementById(id).addEventListener("input",()=>{viewBounds=null; drawMap();}));
["showSatellite","showRadius","utmZone","utmHemisphere"].forEach(id=>document.getElementById(id).addEventListener("input",drawMap));
document.getElementById("zoomIn").onclick=()=>zoomView(.72);
document.getElementById("zoomOut").onclick=()=>zoomView(1.38);
document.getElementById("resetView").onclick=()=>{viewBounds=getInitialBounds(); drawMap();};
const mapCanvas=document.getElementById("mapCanvas");
mapCanvas.addEventListener("wheel",e=>{e.preventDefault(); zoomView(e.deltaY<0?.82:1.22,e.offsetX,e.offsetY);},{passive:false});
mapCanvas.addEventListener("mousedown",e=>{isDragging=true; dragStart=[e.clientX,e.clientY];});
window.addEventListener("mouseup",()=>{isDragging=false;});
window.addEventListener("mousemove",e=>{if(!isDragging||!dragStart)return; const dx=e.clientX-dragStart[0], dy=e.clientY-dragStart[1]; dragStart=[e.clientX,e.clientY]; panView(dx,dy);});

async function loadExampleAssets(){
  try{
    const dxf=await fetch("./assets/examples/plano-de-perfuracao.dxf").then(r=>r.text());
    contour=parseDxf(dxf,n(document.getElementById("dxfUnit").value));
    viewBounds=getInitialBounds();
    document.getElementById("exampleStatus").textContent="Exemplo carregado: poligonal de desmonte. Você pode substituir o DXF pelo seu arquivo.";
    renderSpatialStats();
    run(true);
  }catch(err){
    document.getElementById("exampleStatus").textContent="Não foi possível carregar o exemplo automaticamente. Use o campo de DXF para importar a poligonal.";
  }
}

loadDefaultBlast();
loadExampleAssets();
