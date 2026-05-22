const gravity = 9.80665;
let holes = [];
let results = [];
let contour = [];
let rasterStats = null;
let rasterPreview = null;
let rasterBounds = null;
let orthoPreview = null;
let orthoBounds = null;
let topoLines = [];
let currentRadius = NaN;
let viewBounds = null;
let isDragging = false;
let dragStart = null;
const tileCache = new Map();
let charts = [];
let reportHtml = "";

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
      if(key==="litologia") input.className="lito";
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
  return `<div class="table-wrap"><table><thead><tr>${keys.map(k=>`<th>${k}</th>`).join("")}</tr></thead><tbody>${rows.slice(0,limit).map(r=>`<tr>${keys.map(k=>`<td>${Number.isFinite(r[k])?fmt(r[k]):String(r[k]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
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

function parseDxf(text,scale){
  const lines=text.replace(/\r/g,"").split("\n").map(s=>s.trim());
  const polylines=[];
  for(let i=0;i<lines.length;i++){
    if(lines[i]==="LWPOLYLINE"){
      const pts=[]; let closed=false;
      for(let j=i+1;j<lines.length-1;j+=2){
        const code=lines[j], value=lines[j+1];
        if(code==="0"){i=j-1; break}
        if(code==="70") closed=(Number(value)&1)===1;
        if(code==="10"){
          const x=n(value)*scale;
          let y=NaN;
          for(let k=j+2;k<Math.min(j+10,lines.length-1);k+=2){
            if(lines[k]==="20"){y=n(lines[k+1])*scale; break}
          }
          if(Number.isFinite(x)&&Number.isFinite(y)) pts.push([x,y]);
        }
      }
      if(pts.length>=3) polylines.push({pts,closed});
    }
  }
  const candidates=polylines
    .map(p=>({pts:p.pts,closed:p.closed,stats:polygonStats(p.pts)}))
    .filter(p=>p.stats && p.stats.area_m2>5 && p.stats.largura_m>1 && p.stats.altura_m>1);
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
  const cst=polygonStats(contour), [cx,cy]=centroid(contour), radius=Number.isFinite(currentRadius)?currentRadius:0, pad=42;
  const baseBounds = getInitialBounds();
  if(!viewBounds) viewBounds = baseBounds;
  let {minX,maxX,minY,maxY}=viewBounds;
  const sx=(canvas.width-2*pad)/(maxX-minX||1), sy=(canvas.height-2*pad)/(maxY-minY||1), s=Math.min(sx,sy);
  const px=x=>pad+(x-minX)*s, py=y=>canvas.height-pad-(y-minY)*s;
  const wx=screenX=>minX+(screenX-pad)/s, wy=screenY=>minY+(canvas.height-pad-screenY)/s;
  if(document.getElementById("showSatellite").checked) drawSatellite(ctx,{minX,maxX,minY,maxY},px,py);
  if(orthoPreview && orthoBounds && document.getElementById("showOrtho").checked){
    drawRaster(ctx,orthoPreview,orthoBounds,px,py,s,.92);
  }
  if(rasterPreview && rasterBounds){
    drawRaster(ctx,rasterPreview,rasterBounds,px,py,s,document.getElementById("showOrtho").checked ? .22 : .65);
  }
  if(document.getElementById("showTopo").checked){
    ctx.strokeStyle="rgba(20,50,55,.72)"; ctx.lineWidth=1;
    topoLines.forEach(seg=>{ctx.beginPath();ctx.moveTo(px(seg[0][0]),py(seg[0][1]));ctx.lineTo(px(seg[1][0]),py(seg[1][1]));ctx.stroke();});
  }
  if(!contour.length) return;
  if(radius>0 && document.getElementById("showRadius").checked){
    ctx.beginPath(); ctx.arc(px(cx),py(cy),radius*s,0,Math.PI*2);
    ctx.fillStyle="rgba(118,188,33,.09)"; ctx.fill(); ctx.strokeStyle="#76bc21"; ctx.lineWidth=3; ctx.setLineDash([10,6]); ctx.stroke(); ctx.setLineDash([]);
    const eq=n(document.getElementById("equipmentFactor").value), pe=n(document.getElementById("peopleFactor").value), equipmentRadius=radius*(eq/pe);
    if(Number.isFinite(equipmentRadius)&&equipmentRadius>0){
      ctx.beginPath(); ctx.arc(px(cx),py(cy),equipmentRadius*s,0,Math.PI*2);
      ctx.fillStyle="rgba(0,126,122,.10)"; ctx.fill(); ctx.strokeStyle="#007e7a"; ctx.lineWidth=2; ctx.stroke();
    }
  }
  ctx.beginPath(); contour.forEach(([x,y],i)=>{if(i)ctx.lineTo(px(x),py(y)); else ctx.moveTo(px(x),py(y))}); ctx.closePath();
  ctx.fillStyle="rgba(0,60,70,.26)"; ctx.fill(); ctx.strokeStyle="#003c46"; ctx.lineWidth=4; ctx.stroke();
  ctx.beginPath(); ctx.arc(px(cx),py(cy),4,0,Math.PI*2); ctx.fillStyle="#003c46"; ctx.fill();
  ctx.fillStyle="#003c46"; ctx.font="bold 13px Arial"; ctx.fillText(`Raio pessoas: ${fmt(currentRadius)} m`, px(cx)+10, py(cy)-10);
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
      ctx.globalAlpha=.82;
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

function drawRaster(ctx,img,bounds,px,py,s,alpha){
  const x=px(bounds.minX), y=py(bounds.maxY), w=(bounds.maxX-bounds.minX)*s, h=(bounds.maxY-bounds.minY)*s;
  ctx.globalAlpha=alpha; ctx.drawImage(img,x,y,w,h); ctx.globalAlpha=1;
}

function getInitialBounds(){
  const cst=polygonStats(contour), [cx,cy]=centroid(contour), radius=Number.isFinite(currentRadius)?currentRadius:0;
  if(cst){
    const margin=Math.max(40,radius*1.15);
    return {minX:Math.min(cst.min_x,cx-margin),maxX:Math.max(cst.max_x,cx+margin),minY:Math.min(cst.min_y,cy-margin),maxY:Math.max(cst.max_y,cy+margin)};
  }
  if(orthoBounds) return {...orthoBounds};
  if(rasterBounds) return {...rasterBounds};
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
  if(rasterStats){items.push(["GeoTIFF min",fmt(rasterStats.min)],["GeoTIFF média",fmt(rasterStats.mean)],["GeoTIFF max",fmt(rasterStats.max)],["Pixels amostrados",rasterStats.count]);}
  document.getElementById("spatialStats").innerHTML=items.map(([k,v])=>`<div><strong>${k}</strong><span>${v}</span></div>`).join("");
}

async function readGeoTiff(file){
  const arrayBuffer=await file.arrayBuffer();
  await readGeoTiffBuffer(arrayBuffer, "surface");
}

async function readGeoTiffBuffer(arrayBuffer, kind="surface"){
  const tiff=await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image=await tiff.getImage();
  const samples = image.getSamplesPerPixel ? image.getSamplesPerPixel() : 1;
  const raster=await image.readRasters({samples:samples>=3 && kind==="ortho" ? [0,1,2] : [0]});
  const data=raster[0]; let min=Infinity,max=-Infinity,sum=0,count=0;
  const step=Math.max(1,Math.floor(data.length/250000));
  for(let i=0;i<data.length;i+=step){const v=Number(data[i]); if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);sum+=v;count++;}}
  const stats={min,max,mean:sum/count,count,width:image.getWidth(),height:image.getHeight()};
  let bounds=null;
  try{
    const bb=image.getBoundingBox();
    bounds={minX:bb[0],minY:bb[1],maxX:bb[2],maxY:bb[3]};
  }catch(_){
    bounds=null;
  }
  const w=image.getWidth(), h=image.getHeight(), preview=document.createElement("canvas"), maxSide=700, scale=Math.min(1,maxSide/Math.max(w,h));
  preview.width=Math.max(1,Math.floor(w*scale)); preview.height=Math.max(1,Math.floor(h*scale));
  const pctx=preview.getContext("2d"), img=pctx.createImageData(preview.width,preview.height);
  for(let y=0;y<preview.height;y++){
    for(let x=0;x<preview.width;x++){
      const srcX=Math.floor(x/scale), srcY=Math.floor(y/scale), v=Number(data[srcY*w+srcX]);
      const t=Number.isFinite(v) && max>min ? (v-min)/(max-min) : 0;
      const idx=(y*preview.width+x)*4;
      if(kind==="ortho" && raster.length>=3){
        img.data[idx]=Number(raster[0][srcY*w+srcX])||0; img.data[idx+1]=Number(raster[1][srcY*w+srcX])||0; img.data[idx+2]=Number(raster[2][srcY*w+srcX])||0; img.data[idx+3]=255;
      }else{
        const shade=Math.max(40,Math.min(235,Math.round(235-t*145)));
        img.data[idx]=shade-20; img.data[idx+1]=shade; img.data[idx+2]=shade-15; img.data[idx+3]=255;
      }
    }
  }
  pctx.putImageData(img,0,0);
  if(kind==="ortho"){orthoPreview=preview; orthoBounds=bounds;}
  else {rasterPreview=preview; rasterBounds=bounds; rasterStats=stats; topoLines=buildTopoLines(data,w,h,min,max,rasterBounds);}
  renderSpatialStats();
  drawMap();
}

function buildTopoLines(data,w,h,min,max,bounds){
  if(!bounds || !(max>min)) return [];
  const cols=140, rows=Math.max(30,Math.round(cols*h/w)), grid=[];
  for(let gy=0;gy<=rows;gy++){
    const row=[]; const sy=Math.min(h-1,Math.round(gy*h/rows));
    for(let gx=0;gx<=cols;gx++){
      const sx=Math.min(w-1,Math.round(gx*w/cols));
      row.push(Number(data[sy*w+sx]));
    }
    grid.push(row);
  }
  const levels=[]; const interval=(max-min)/9;
  for(let i=1;i<9;i++) levels.push(min+interval*i);
  const wx=gx=>bounds.minX+(gx/cols)*(bounds.maxX-bounds.minX);
  const wy=gy=>bounds.maxY-(gy/rows)*(bounds.maxY-bounds.minY);
  const interp=(p1,p2,v1,v2,level)=>{const t=(level-v1)/((v2-v1)||1); return [p1[0]+(p2[0]-p1[0])*t,p1[1]+(p2[1]-p1[1])*t];};
  const lines=[];
  for(const level of levels){
    for(let y=0;y<rows;y++){
      for(let x=0;x<cols;x++){
        const v=[grid[y][x],grid[y][x+1],grid[y+1][x+1],grid[y+1][x]];
        if(v.some(q=>!Number.isFinite(q))) continue;
        const p=[[wx(x),wy(y)],[wx(x+1),wy(y)],[wx(x+1),wy(y+1)],[wx(x),wy(y+1)]];
        const hits=[];
        [[0,1],[1,2],[2,3],[3,0]].forEach(([a,b])=>{if((v[a]<level&&v[b]>=level)||(v[b]<level&&v[a]>=level)) hits.push(interp(p[a],p[b],v[a],v[b],level));});
        if(hits.length===2) lines.push([hits[0],hits[1]]);
        if(hits.length===4){lines.push([hits[0],hits[1]]); lines.push([hits[2],hits[3]]);}
      }
    }
  }
  return lines.slice(0,9000);
}

function run(silent=false){
  const k=n(document.getElementById("kValue").value), angle=n(document.getElementById("angleValue").value), people=n(document.getElementById("peopleFactor").value), equipment=n(document.getElementById("equipmentFactor").value);
  results=holes.map(h=>validateAndCompute(h,k,angle));
  const valid=results.filter(r=>r.validation_status==="valid");
  const lmax=valid.map(r=>r.lmax_previsto_m);
  const mode=document.getElementById("referenceMode").value;
  const ref=lmax.length ? (mode==="p95"?percentile(lmax,.95):mode==="p90"?percentile(lmax,.90):mode==="mean"?mean(lmax):Math.max(...lmax)) : NaN;
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
    new Chart(document.getElementById("lmaxChart"),{type:"bar",data:{labels:valid.map((r,i)=>r.litologia || `Condição ${i+1}`),datasets:[{label:"Lmax previsto (m)",data:lmax,backgroundColor:"#007e7a"}]},options:{plugins:{legend:{display:false}}}}),
  ];
  reportHtml=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body><h1>Relatório Terrock Flyrock</h1><p>Desmonte: ${document.getElementById("blastName").value}. K=${k}. Ângulo=${angle}°. Lmax referência=${fmt(ref)} m. Raio pessoas=${fmt(ref*people)} m.</p><p>Ferramenta de apoio técnico; não substitui responsável técnico habilitado.</p><h2>Resultados</h2>${table(results,resultKeys)}<h2>Desenho inverso</h2>${table(inverse,["litologia","lmax_atual_m","raio_atual_pessoas_m","lmax_permitido_m","tampao_necessario_m","cme_necessaria_kg","alerta"])}</body></html>`;
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
<Style id="poly"><LineStyle><color>ff463c00</color><width>3</width></LineStyle><PolyStyle><color>55463c00</color></PolyStyle></Style>
<Style id="people"><LineStyle><color>ff21bc76</color><width>3</width></LineStyle><PolyStyle><color>2521bc76</color></PolyStyle></Style>
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
  const modeLabel={max:"máximo",p95:"P95",p90:"P90",mean:"média"}[mode] || mode;
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
  document.getElementById("technicalNotes").innerHTML=[
    ["Condição crítica",`${critical.litologia || "Desmonte"}: maior Lmax previsto (${fmt(critical.lmax_previsto_m)} m).`],
    ["Malha média",`Afastamento ${fmt(avgBurden)} m; espaçamento ${fmt(avgSpacing)} m.`],
    ["K selecionado",`K=${fmt(k,1)}. Atenção: Lmax varia com K²; reduzir K pela metade reduz Lmax para cerca de 1/4.`],
    ["Confinamento",lowStemming?`${lowStemming} furo(s) com tampão/profundidade < 0,25.`:"Relação tampão/profundidade sem alerta crítico."]
  ].map(([k,v])=>`<div><strong>${k}</strong><span>${v}</span></div>`).join("");
}

document.getElementById("addHoleBtn").onclick=()=>addHole(emptyHole());
function loadDefaultBlast(){
  document.getElementById("blastName").value = "Fogo 01";
  document.getElementById("kPreset").value = "21.9";
  document.getElementById("kValue").value = "21.9";
  document.getElementById("angleValue").value = "45";
  document.getElementById("peopleFactor").value = "4";
  document.getElementById("equipmentFactor").value = "2";
  document.getElementById("targetRadius").value = "600";
  document.getElementById("referenceMode").value = "max";
  holes=[];
  addHole({litologia:"SULFETO",densidade_litologica_g_cm3:2.8,diametro_furo_pol:6.5,profundidade_m:12,afastamento_m:4,espacamento_m:5,tampao_real_m:4.1,carga_maxima_espera_kg:170,massa_desmontada_kt:10,razao_carga:0.75});
  addHole({litologia:"OXIDADO",densidade_litologica_g_cm3:2.4,diametro_furo_pol:6.5,profundidade_m:10,afastamento_m:4,espacamento_m:5,tampao_real_m:5,carga_maxima_espera_kg:135,massa_desmontada_kt:10,razao_carga:0.75});
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
document.getElementById("geotiffFile").onchange=async e=>{const file=e.target.files[0]; if(file){await readGeoTiff(file); viewBounds=getInitialBounds(); drawMap();}};
document.getElementById("orthoFile").onchange=async e=>{const file=e.target.files[0]; if(file){await readGeoTiffBuffer(await file.arrayBuffer(),"ortho"); viewBounds=getInitialBounds(); drawMap();}};
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
["showSatellite","showOrtho","showTopo","showRadius","utmZone","utmHemisphere"].forEach(id=>document.getElementById(id).addEventListener("input",drawMap));
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
    const [surface,ortho,dxf]=await Promise.all([
      fetch("./assets/examples/curvas-de-nivel.tif").then(r=>r.arrayBuffer()),
      fetch("./assets/examples/ortomosaico.tif").then(r=>r.arrayBuffer()),
      fetch("./assets/examples/plano-de-perfuracao.dxf").then(r=>r.text())
    ]);
    await readGeoTiffBuffer(ortho,"ortho");
    await readGeoTiffBuffer(surface,"surface");
    contour=parseDxf(dxf,n(document.getElementById("dxfUnit").value));
    viewBounds=getInitialBounds();
    document.getElementById("exampleStatus").textContent="Exemplo carregado: ortomosaico, curvas de nível e plano de perfuração. Você pode substituir qualquer camada.";
    renderSpatialStats();
    run(true);
  }catch(err){
    document.getElementById("exampleStatus").textContent="Não foi possível carregar o exemplo automaticamente. Use os campos acima para importar GeoTIFF, ortomosaico e DXF.";
  }
}

loadDefaultBlast();
loadExampleAssets();
