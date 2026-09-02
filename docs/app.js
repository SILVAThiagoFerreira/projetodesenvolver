const gravity = 9.80665;
let holes = [];
let results = [];
let contour = [];
let contourGeo = [];
let currentRadius = NaN;
let currentEquipmentRadius = NaN;
let viewBounds = null;
let isDragging = false;
let dragStart = null;
const tileCache = new Map();
let charts = [];
let reportHtml = "";
let satelliteLoadAttempted = false;
let dxfSourceText = "";

const V = {
  turquoise: "#00939A",
  yellow: "#ECB833",
  gray: "#77787B",
  border: "#D9DDDD",
  polyStroke: "#00939A",
};

const fields = [
  ["litologia","text","ITABIRITO"],["densidade_litologica_g_cm3","number","2.7"],["diametro_furo_pol","number","6.5"],
  ["profundidade_m","number","12"],["afastamento_m","number","4"],["espacamento_m","number","5"],
  ["tampao_real_m","number","3.5"],["carga_maxima_espera_kg","number","175"],["massa_desmontada_kt","number","10"],
  ["razao_carga","number","0.75"]
];

function n(v){const x=Number(String(v ?? "").replace(",",".")); return Number.isFinite(x)?x:NaN}
function resolveDxfScale(text,selected){
  if(selected !== "auto"){
    const manual=n(selected);
    return Number.isFinite(manual) && manual>0 ? manual : 1;
  }
  const pairs=String(text ?? "").replace(/\r/g,"").split("\n").map(s=>s.trim());
  for(let i=0;i<pairs.length-1;i+=2){
    if(pairs[i]==="9" && pairs[i+1]==="$INSUNITS"){
      for(let j=i+2;j<pairs.length-1;j+=2){
        if(pairs[j]==="70"){
          const factors={1:0.0254,2:0.3048,4:0.001,5:0.01,6:1,7:1000};
          return factors[Number(pairs[j+1])] ?? 1;
        }
        if(pairs[j]==="9" || pairs[j]==="0") break;
      }
    }
  }
  return 1;
}
function fmt(v,d=2){return Number.isFinite(v)?Number(v).toFixed(d):"-"}
function percentile(a,p){const x=a.filter(Number.isFinite).sort((u,v)=>u-v); if(!x.length)return NaN; const i=(x.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return x[lo]+(x[hi]-x[lo])*(i-lo)}
function mean(a){const x=a.filter(Number.isFinite); return x.length?x.reduce((s,v)=>s+v,0)/x.length:NaN}
function terrockLmax(k,cl,ds,angle){
  return (k*k/gravity)*Math.pow(cl/ds,1.3)*Math.pow(Math.sin(angle*Math.PI/180),2);
}
function csv(rows){const keys=Object.keys(rows[0]||{}); return [keys.join(";"),...rows.map(r=>keys.map(k=>String(r[k]??"").replaceAll(";"," ")).join(";"))].join("\n")}
function download(name,content,type){const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click()}

function addHole(seed={}){
  const row = {...Object.fromEntries(fields.map(([key,,def]) => [key, seed[key] ?? def])), ...seed};
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
    // A coluna da base está nomeada como kt, mas os valores são a massa da
    // malha em toneladas (por exemplo, 325,248 t). Não converter novamente.
    r.massa_desmontada_t=Number.isFinite(r.massa_desmontada_kt) && r.massa_desmontada_kt>0 ? r.massa_desmontada_kt : r.massa_estimativa_t;
    r.razao_carga_calculada_kg_t=r.carga_maxima_espera_kg/r.massa_desmontada_t;
    r.razao_tampao_profundidade=r.tampao_real_m/r.profundidade_m;
    r.energia_relativa=r.carga_maxima_espera_kg/r.tampao_real_m;
    r.tampao_efetivo_m=r.tampao_real_m;
    r.indice_confinamento=r.tampao_efetivo_m/r.carga_linear_kg_m;
    r.lmax_terrock_m=terrockLmax(k,r.carga_linear_kg_m,r.tampao_efetivo_m,angle);
    r.lmax_previsto_m=r.lmax_terrock_m;
    r.raio_pessoas_m=r.lmax_previsto_m*n(document.getElementById("peopleFactor").value);
    r.raio_equipamentos_m=r.lmax_previsto_m*n(document.getElementById("equipmentFactor").value);
  }
  return r;
}

const TABLE_LABELS={
  litologia:"Litologia", coluna_carregada_m:"Coluna (m)", carga_linear_kg_m:"Carga linear (kg/m)",
  profundidade_m:"Profundidade (m)", tampao_real_m:"Tampão real (m)", carga_maxima_espera_kg:"CME (kg)",
  massa_desmontada_kt:"Massa (t)", razao_carga:"Razão informada (kg/t)", razao_carga_calculada_kg_t:"Razão calculada (kg/t)",
  razao_tampao_profundidade:"Tampão / prof.", lmax_previsto_m:"Lmax (m)",
  raio_equipamentos_m:"Raio equip. (m)", raio_pessoas_m:"Raio pessoas (m)", raio_alvo_pessoas_m:"Alvo pessoas (m)", raio_alvo_equipamentos_m:"Alvo equip. (m)",
  raio_atual_equipamentos_m:"Raio atual equip. (m)",
  validation_status:"Status", validation_errors:"Erros", lmax_atual_m:"Lmax atual (m)", limite_controlador:"Limite controlador",
  raio_atual_pessoas_m:"Raio atual pessoas (m)", lmax_permitido_m:"Lmax permitido (m)",
  fonte_lmax:"Fonte Lmax", estado_adequacao:"Estado", tampao_atual_m:"Tampão atual (m)",
  tampao_necessario_m:"Tampão necessário (m)", aumento_tampao_m:"Aumento tampão (m)",
  cme_atual_kg:"CME atual (kg)", cme_necessaria_kg:"CME necessária (kg)", cme_com_tampao_kg:"CME com tampão (kg)",
  reducao_cme_pct:"Redução CME (%)", razao_carga_atual_kg_t:"Razão atual (kg/t)",
  razao_carga_com_cme_kg_t:"Razão com CME (kg/t)", razao_carga_com_tampao_kg_t:"Razão com tampão (kg/t)", alerta:"Alerta"
};

function table(rows, keys, limit=100){
  if(!rows.length) return "<p>Sem dados calculados.</p>";
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${keys.map(k=>`<th>${TABLE_LABELS[k]||k}</th>`).join("")}</tr></thead><tbody>${rows.slice(0,limit).map(r=>`<tr>${keys.map(k=>{
    const isNumber = Number.isFinite(r[k]);
    const value = isNumber ? fmt(r[k]) : String(r[k] ?? "");
    return `<td class="${isNumber ? "is-number" : ""}">${value}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function inverseRows(valid,k,angle,targetPeople,peopleFactor,targetEquipment,equipmentFactor){
  const allowedPeople=targetPeople/peopleFactor;
  const allowedEquipment=targetEquipment/equipmentFactor;
  const allowed=Math.min(allowedPeople,allowedEquipment);
  const limiting=allowedPeople<=allowedEquipment?"pessoas":"equipamentos";
  return valid.map(r=>{
    const observedLmax=n(r.distancia_horizontal_m);
    const lmaxAtual=Number.isFinite(observedLmax) && observedLmax>0 ? observedLmax : r.lmax_previsto_m;
    const fonteLmax=Number.isFinite(observedLmax) && observedLmax>0 ? "observado na base" : "Terrock previsto";
    const needsAdjustment=lmaxAtual>allowed;
    const reductionFactor=needsAdjustment ? Math.pow(allowed/lmaxAtual,1/1.3) : 1;
    const tampaoNec=r.tampao_real_m/reductionFactor;
    const cargaNec=r.carga_maxima_espera_kg*reductionFactor;
    const colunaComTampao=Math.max(0,r.profundidade_m-tampaoNec);
    const cargaComTampao=r.carga_linear_kg_m*colunaComTampao;
    const massaT=r.massa_desmontada_t;
    const ratioAtual=r.razao_carga_calculada_kg_t;
    const ratioComCme=cargaNec/massaT;
    const ratioComTampao=cargaComTampao/massaT;
    const alerta=needsAdjustment
      ? (tampaoNec<r.profundidade_m && cargaNec>0 ? "viavel como triagem" : "requer redesenho tecnico")
      : "conforme para este alvo";
    return {
      litologia:r.litologia, lmax_atual_m:lmaxAtual, fonte_lmax:fonteLmax, estado_adequacao:needsAdjustment?"ajustar":"manter", raio_atual_pessoas_m:lmaxAtual*peopleFactor, raio_atual_equipamentos_m:lmaxAtual*equipmentFactor,
      raio_alvo_pessoas_m:targetPeople, raio_alvo_equipamentos_m:targetEquipment, lmax_permitido_m:allowed, limite_controlador:limiting, tampao_atual_m:r.tampao_real_m,
      tampao_necessario_m:tampaoNec, aumento_tampao_m:Math.max(0,tampaoNec-r.tampao_real_m),
      cme_atual_kg:r.carga_maxima_espera_kg, cme_necessaria_kg:cargaNec, cme_com_tampao_kg:cargaComTampao,
      reducao_cme_pct:Math.max(0,(1-cargaNec/r.carga_maxima_espera_kg)*100), razao_carga_atual_kg_t:ratioAtual,
      razao_carga_com_cme_kg_t:ratioComCme, razao_carga_com_tampao_kg_t:ratioComTampao,
      alerta
    };
  });
}

function inverseSummary(rows,targetPeople,targetEquipment){
  if(!rows.length) return "";
  const adjusted=rows.filter(r=>r.estado_adequacao==="ajustar");
  const maxBasePeople=Math.max(...rows.map(r=>r.raio_atual_pessoas_m));
  const maxBaseEquipment=Math.max(...rows.map(r=>r.raio_atual_equipamentos_m));
  const maxStem=adjusted.length ? Math.max(...adjusted.map(r=>r.aumento_tampao_m)) : 0;
  const maxCmeReduction=adjusted.length ? Math.max(...adjusted.map(r=>r.reducao_cme_pct)) : 0;
  const allowed=rows[0].lmax_permitido_m;
  const limiting=rows[0].limite_controlador;
  const status=adjusted.length ? `${adjusted.length} de ${rows.length} furo(s) acima do alvo` : "nenhum furo acima do alvo";
  return `<div class="inverse-summary">
    <p class="inverse-summary__lead"><strong>O raio menor é o alvo do cenário, não um novo cálculo da base.</strong> A base apresenta ${fmt(maxBasePeople)} m para pessoas e ${fmt(maxBaseEquipment)} m para equipamentos. Para este alvo, cada furo deve ficar com Lmax ≤ ${fmt(allowed)} m; o limite controlador é ${limiting}.</p>
    <div class="inverse-summary__metrics">
      <div><span>Necessidade</span><strong>${status}</strong></div>
      <div><span>Alvo do cenário</span><strong>${fmt(targetPeople)} m / ${fmt(targetEquipment)} m</strong><small>pessoas / equipamentos</small></div>
      <div><span>Alternativa A · tampão</span><strong>até +${fmt(maxStem)} m</strong><small>por furo, mantendo a carga linear</small></div>
      <div><span>Alternativa B · CME</span><strong>até -${fmt(maxCmeReduction)}%</strong><small>por furo, mantendo o tampão</small></div>
    </div>
    <p class="inverse-summary__note">As alternativas A e B são opções de triagem, não devem ser somadas automaticamente. As linhas marcadas como “manter” já atendem ao alvo e conservam o plano da base. Consulte a tabela para o valor específico de cada furo.</p>
  </div>`;
}

function projectGeoContour(points, zone, hemisphere){
  return points.map(([lon,lat])=>{
    const utm = lonLatToUtm(lon,lat,zone,hemisphere);
    return [utm.easting, utm.northing];
  });
}

function syncContourProjection(){
  if(!contourGeo.length) return;
  const zone=n(document.getElementById("utmZone").value), hemisphere=document.getElementById("utmHemisphere").value;
  if(!(zone>=1 && zone<=60)) return;
  contour=projectGeoContour(contourGeo, zone, hemisphere);
}

function detectUtmZoneFromGeo(points){
  if(!points.length) return {zone:23, hemisphere:"S"};
  const lon=mean(points.map(([x])=>x)), lat=mean(points.map(([,y])=>y));
  const zone=Math.max(1,Math.min(60,Math.floor((lon+180)/6)+1));
  return {zone, hemisphere:lat>=0?"N":"S"};
}

function parseKmlCoordinateList(text){
  const pts=String(text ?? "").trim().split(/\s+/).map(token=>token.split(",")).map(parts=>[n(parts[0]),n(parts[1])]).filter(([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat));
  if(pts.length>1){
    const [fx,fy]=pts[0], [lx,ly]=pts[pts.length-1];
    if(Math.hypot(fx-lx,fy-ly)<1e-12) pts.pop();
  }
  return pts;
}

function approximateGeoArea(points){
  if(points.length<3) return 0;
  const lat0=mean(points.map(([,lat])=>lat))*Math.PI/180;
  const cosLat=Math.cos(lat0);
  const projected=points.map(([lon,lat])=>[lon*cosLat,lat]);
  const stats=polygonStats(projected);
  return stats ? stats.area_m2 : 0;
}

function parseKmlContour(text){
  const xml=new DOMParser().parseFromString(text,"application/xml");
  if(xml.querySelector("parsererror")) return [];
  const nodes=xml.getElementsByTagNameNS ? Array.from(xml.getElementsByTagNameNS("*","coordinates")) : Array.from(xml.getElementsByTagName("coordinates"));
  const candidates=nodes
    .map(node=>parseKmlCoordinateList(node.textContent))
    .filter(pts=>pts.length>=3)
    .map(pts=>({pts,area:approximateGeoArea(pts)}))
    .sort((a,b)=>b.area-a.area);
  return candidates[0]?.pts ?? [];
}

async function readKmzKmlText(file){
  if(typeof JSZip === "undefined") throw new Error("Suporte KMZ indisponível.");
  const zip=await JSZip.loadAsync(await file.arrayBuffer());
  const kmlName=Object.keys(zip.files).find(name=>/\.kml$/i.test(name) && !zip.files[name].dir);
  if(!kmlName) throw new Error("KMZ sem arquivo KML.");
  return zip.file(kmlName).async("text");
}

async function importContourFile(file){
  const name=file.name.toLowerCase();
  if(name.endsWith(".kmz") || name.endsWith(".kml")){
    const text=name.endsWith(".kmz") ? await readKmzKmlText(file) : await file.text();
    contourGeo=parseKmlContour(text);
    if(!contourGeo.length) throw new Error("Não foi possível encontrar a poligonal no KMZ/KML.");
    const {zone, hemisphere}=detectUtmZoneFromGeo(contourGeo);
    document.getElementById("utmZone").value=String(zone);
    document.getElementById("utmHemisphere").value=hemisphere;
    syncContourProjection();
    viewBounds=null;
    document.getElementById("exampleStatus").textContent=`Poligonal ${name.endsWith(".kmz") ? "KMZ" : "KML"} importada. Zona UTM ${zone}${hemisphere} selecionada automaticamente.`;
    renderSpatialStats();
    run(true);
    drawMap();
    return;
  }
  contourGeo=[];
  dxfSourceText=await file.text();
  const dxfScale=resolveDxfScale(dxfSourceText,document.getElementById("dxfUnit").value);
  contour=parseDxf(dxfSourceText,dxfScale);
  if(!contour.length) throw new Error("Não foi possível encontrar uma poligonal fechada no DXF. Verifique se o arquivo contém LINE, LWPOLYLINE ou POLYLINE.");
  viewBounds=null;
  document.getElementById("exampleStatus").textContent=`Poligonal DXF importada. Escala aplicada: ${fmt(dxfScale,4)}. Ajuste a Zona UTM e o Hemisfério se necessário.`;
  renderSpatialStats();
  run(true);
  drawMap();
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
  const lines=String(text ?? "").replace(/\r/g,"").split("\n").map(s=>s.trim());
  const segments=[];
  const polylines=[];
  let currentType=null;
  let entity=null;
  let classicPolyline=null;
  let index=0;

  const nextToken=()=>{
    while(index<lines.length && lines[index]==="") index+=1;
    return index<lines.length ? lines[index++] : null;
  };
  const closePoints=pts=>{
    const out=pts.slice();
    if(out.length>=2){
      const [fx,fy]=out[0], [lx,ly]=out[out.length-1];
      if(Math.hypot(fx-lx,fy-ly)>0.001) out.push([fx,fy]);
    }
    return out;
  };
  const flushEntity=()=>{
    if(currentType==="LINE" && entity && [entity.x1,entity.y1,entity.x2,entity.y2].every(Number.isFinite)){
      segments.push([[entity.x1,entity.y1],[entity.x2,entity.y2]]);
    }else if(currentType==="LWPOLYLINE" && entity?.pts?.length>=3){
      polylines.push({pts:closePoints(entity.pts),closed:Boolean(entity.closed)});
    }else if(currentType==="VERTEX" && classicPolyline && entity && Number.isFinite(entity.x) && Number.isFinite(entity.y)){
      classicPolyline.pts.push([entity.x,entity.y]);
    }
    currentType=null;
    entity=null;
  };
  const flushClassic=()=>{
    if(classicPolyline?.pts?.length>=3) polylines.push({pts:closePoints(classicPolyline.pts),closed:classicPolyline.closed});
    classicPolyline=null;
  };

  while(index<lines.length){
    const code=nextToken();
    if(code===null) break;
    const value=nextToken();
    if(value===null) break;
    if(code==="0"){
      if(value==="POLYLINE"){
        flushEntity();
        flushClassic();
        currentType="POLYLINE";
        classicPolyline={pts:[],closed:false};
        continue;
      }
      if(value==="VERTEX" && classicPolyline){
        flushEntity();
        currentType="VERTEX";
        entity={x:NaN,y:NaN};
        continue;
      }
      if(value==="SEQEND" && classicPolyline){
        flushEntity();
        flushClassic();
        currentType="SEQEND";
        entity=null;
        continue;
      }
      flushEntity();
      currentType=value;
      if(currentType==="LINE") entity={x1:NaN,y1:NaN,x2:NaN,y2:NaN};
      else if(currentType==="LWPOLYLINE") entity={pts:[],closed:false,pendingX:NaN};
      continue;
    }
    if(currentType==="LINE" && entity){
      if(code==="10") entity.x1=n(value)*scale;
      else if(code==="20") entity.y1=n(value)*scale;
      else if(code==="11") entity.x2=n(value)*scale;
      else if(code==="21") entity.y2=n(value)*scale;
    }else if(currentType==="LWPOLYLINE" && entity){
      if(code==="70") entity.closed=(Number(value)&1)===1;
      else if(code==="10") entity.pendingX=n(value)*scale;
      else if(code==="20" && Number.isFinite(entity.pendingX)){
        entity.pts.push([entity.pendingX,n(value)*scale]);
        entity.pendingX=NaN;
      }
    }else if(currentType==="POLYLINE" && classicPolyline){
      if(code==="70") classicPolyline.closed=(Number(value)&1)===1;
    }else if(currentType==="VERTEX" && entity){
      if(code==="10") entity.x=n(value)*scale;
      else if(code==="20") entity.y=n(value)*scale;
    }
  }
  flushEntity();
  flushClassic();

  const lineContours = collectSegmentComponents(segments)
    .map(component=>chainClosedComponent(segments, component))
    .filter(pts=>pts && pts.length >= 3)
    .map(pts=>({pts,stats:polygonStats(pts)}))
    .filter(p=>p.stats && p.stats.area_m2>0.000001 && p.stats.largura_m>0.000001 && p.stats.altura_m>0.000001);

  const polylineContours=polylines
    .map(p=>({pts:p.pts,stats:polygonStats(p.pts)}))
    .filter(p=>p.stats && p.stats.area_m2>0.000001 && p.stats.largura_m>0.000001 && p.stats.altura_m>0.000001);

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
  syncContourProjection();
  const canvas=document.getElementById("mapCanvas"), ctx=canvas.getContext("2d");
  // O mapa pode ser redesenhado enquanto os tiles chegam da rede. Um fundo
  // estável evita o corte branco/glitch entre áreas carregadas e pendentes.
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle="#F2F4F4";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.strokeStyle="rgba(77, 77, 77, .13)";
  ctx.lineWidth=1;
  for(let x=0;x<canvas.width;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
  for(let y=0;y<canvas.height;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
  ctx.restore();
  const [cx,cy]=centroid(contour), radius=Number.isFinite(currentRadius)?currentRadius:0, pad=42;
  const baseBounds = getInitialBounds();
  if(!viewBounds) viewBounds = baseBounds;
  let {minX,maxX,minY,maxY}=viewBounds;
  const sx=(canvas.width-2*pad)/(maxX-minX||1), sy=(canvas.height-2*pad)/(maxY-minY||1), s=Math.min(sx,sy);
  const px=x=>pad+(x-minX)*s, py=y=>canvas.height-pad-(y-minY)*s;
  const wx=screenX=>minX+(screenX-pad)/s, wy=screenY=>minY+(canvas.height-pad-screenY)/s;
  try{
    drawSatellite(ctx,{minX,maxX,minY,maxY},px,py);
  }catch(err){
    if(!satelliteLoadAttempted){
      console.warn("Camada de satélite indisponível", err);
      satelliteLoadAttempted = true;
    }
  }
  if(!contour.length) return;
  if(radius>0 && document.getElementById("showRadius").checked){
    ctx.beginPath(); ctx.arc(px(cx),py(cy),radius*s,0,Math.PI*2);
    ctx.fillStyle="rgba(236,184,51,.16)"; ctx.fill(); ctx.strokeStyle="#ECB833"; ctx.lineWidth=2; ctx.setLineDash([8,5]); ctx.stroke(); ctx.setLineDash([]);
    const equipmentRadius=Number.isFinite(currentEquipmentRadius)?currentEquipmentRadius:radius;
    if(Number.isFinite(equipmentRadius)&&equipmentRadius>0){
      ctx.beginPath(); ctx.arc(px(cx),py(cy),equipmentRadius*s,0,Math.PI*2);
      ctx.fillStyle="rgba(0,147,154,.10)"; ctx.fill(); ctx.strokeStyle="#00939A"; ctx.lineWidth=1.5; ctx.stroke();
    }
  }
  ctx.beginPath(); contour.forEach(([x,y],i)=>{if(i)ctx.lineTo(px(x),py(y)); else ctx.moveTo(px(x),py(y))}); ctx.closePath();
  ctx.fillStyle="rgba(0,167,157,.12)"; ctx.fill(); ctx.strokeStyle=V.polyStroke; ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath(); ctx.arc(px(cx),py(cy),3,0,Math.PI*2); ctx.fillStyle=V.polyStroke; ctx.fill();
  ctx.fillStyle=V.gray; ctx.font="600 11px Inter, Arial"; ctx.fillText(`Raio pessoas: ${fmt(currentRadius)} m`, px(cx)+10, py(cy)-10);
  ctx.font="11px Inter, Arial"; ctx.fillStyle=V.gray; ctx.fillText(`Poligonal do desmonte`, px(cx)+10, py(cy)+8);
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
      if(!img.complete || img.naturalWidth===0 || img.naturalHeight===0) continue;
      const nw=tileToLonLat(x,y,z), se=tileToLonLat(x+1,y+1,z);
      const p1=lonLatToUtm(nw.lon,nw.lat,zone,hemi), p2=lonLatToUtm(se.lon,se.lat,zone,hemi);
      ctx.save();
      ctx.globalAlpha=.8;
      try{
        ctx.drawImage(img,px(p1.easting),py(p1.northing),px(p2.easting)-px(p1.easting),py(p2.northing)-py(p1.northing));
      }catch(_){
        // Ignore individual tile failures so the contour still renders.
      }finally{
        ctx.restore();
      }
    }
  }
}

function getTile(z,x,y){
  const key=`${z}/${x}/${y}`;
  if(tileCache.has(key)) return tileCache.get(key);
  const img=new Image();
  img.onload=drawMap;
  img.onerror=drawMap;
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
  syncContourProjection();
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
  syncContourProjection();
  const dxf=polygonStats(contour);
  const items=[];
  if(dxf){items.push(["Área DXF",`${fmt(dxf.area_m2)} m²`],["Perímetro DXF",`${fmt(dxf.perimetro_m)} m`],["Largura x altura",`${fmt(dxf.largura_m)} x ${fmt(dxf.altura_m)} m`],["Pontos DXF",dxf.pontos]);}
  document.getElementById("spatialStats").innerHTML=items.map(([k,v])=>`<div><strong>${k}</strong><span>${v}</span></div>`).join("");
}

function run(silent=false){
  const k=n(document.getElementById("kValue").value), angle=n(document.getElementById("angleValue").value), people=n(document.getElementById("peopleFactor").value), equipment=n(document.getElementById("equipmentFactor").value);
  results=holes.map(h=>validateAndCompute(h,k,angle));
  const valid=results.filter(r=>r.validation_status==="valid");
  const status=document.getElementById("calculationStatus");
  if(status){
    status.textContent=valid.length ? `${valid.length} furo(s) válido(s) · pronto para exportar` : "Revise os parâmetros antes de exportar";
    status.className=`results-intro__status${valid.length ? " results-intro__status--ok" : " results-intro__status--warning"}`;
  }
  const lmax=valid.map(r=>r.lmax_previsto_m);
  const mode=document.getElementById("referenceMode").value;
  const observed=valid.map(r=>n(r.distancia_horizontal_m));
  const observedMax=observed.filter(Number.isFinite);
  const ref=lmax.length ? (mode==="median"?percentile(lmax,.5):mode==="p95"?percentile(lmax,.95):mode==="p90"?percentile(lmax,.90):mode==="mean"?mean(lmax):observedMax.length?Math.max(...observedMax):Math.max(...lmax)) : NaN;
  currentRadius=Number.isFinite(ref) ? ref*people : NaN;
  const equipmentRadius=Number.isFinite(ref) ? ref*equipment : NaN;
  currentEquipmentRadius=equipmentRadius;
  document.getElementById("holeCount").textContent=valid.length;
  document.getElementById("lmaxRef").textContent=`${fmt(ref)} m`;
  document.getElementById("peopleRadius").textContent=`${fmt(currentRadius)} m`;
  document.getElementById("equipmentRadius").textContent=`${fmt(equipmentRadius)} m`;
  updateEquationPanel(valid,k,angle,ref,people,equipment,mode);
  const resultKeys=["litologia","profundidade_m","tampao_real_m","coluna_carregada_m","carga_maxima_espera_kg","carga_linear_kg_m","massa_desmontada_kt","razao_carga","razao_carga_calculada_kg_t","razao_tampao_profundidade","lmax_previsto_m","raio_equipamentos_m","raio_pessoas_m","validation_status","validation_errors"];
  document.getElementById("resultsTable").innerHTML=table(results,resultKeys);
  const inverseTargets=[
    {people:n(document.getElementById("scenario1PeopleRadius").value),equipment:n(document.getElementById("scenario1EquipmentRadius").value),title:"Cenário 1"},
    {people:n(document.getElementById("scenario2PeopleRadius").value),equipment:n(document.getElementById("scenario2EquipmentRadius").value),title:"Cenário 2"}
  ];
  const inverse=inverseRows(valid,k,angle,inverseTargets[0].people,people,inverseTargets[0].equipment,equipment);
  const inverseKeys=["litologia","lmax_atual_m","fonte_lmax","estado_adequacao","raio_atual_pessoas_m","raio_atual_equipamentos_m","raio_alvo_pessoas_m","raio_alvo_equipamentos_m","lmax_permitido_m","limite_controlador","tampao_atual_m","tampao_necessario_m","aumento_tampao_m","cme_atual_kg","cme_necessaria_kg","cme_com_tampao_kg","reducao_cme_pct","razao_carga_atual_kg_t","razao_carga_com_cme_kg_t","razao_carga_com_tampao_kg_t","alerta"];
  document.getElementById("inverseTable").innerHTML=inverseTargets.map(({people:targetPeople,equipment:targetEquipment,title})=>{
    const scenarioRows=inverseRows(valid,k,angle,targetPeople,people,targetEquipment,equipment);
    return `<section class="inverse-config"><h4>${title}: adequações para pessoas (${fmt(targetPeople)} m) e equipamentos (${fmt(targetEquipment)} m)</h4>${inverseSummary(scenarioRows,targetPeople,targetEquipment)}${table(scenarioRows,inverseKeys)}</section>`;
  }).join("");
  renderTechnicalNotes(valid,ref,people,equipment);
  drawMap();
  charts.forEach(c=>c.destroy());
  charts=[
    new Chart(document.getElementById("lmaxChart"),{type:"bar",data:{labels:valid.map((r,i)=>r.litologia || `Condição ${i+1}`),datasets:[{label:"Lmax previsto (m)",data:lmax,backgroundColor:V.turquoise,borderColor:V.turquoise,borderRadius:0,borderSkipped:false,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:4,right:8,bottom:0,left:8}},plugins:{legend:{display:false},title:{display:true,text:"Lmax previsto por condição",color:V.gray,font:{family:"Inter, Arial",size:13,weight:"600"},padding:{bottom:12}},tooltip:{backgroundColor:V.gray,titleColor:"#fff",bodyColor:"#fff",padding:10,borderRadius:0,displayColors:false}},scales:{x:{grid:{display:false},ticks:{color:V.gray,font:{family:"Inter, Arial",size:11,weight:"500"},maxRotation:0,autoSkip:false}},y:{beginAtZero:true,grid:{color:"#D9DDDD",drawBorder:false},ticks:{color:V.gray,font:{family:"Inter, Arial",size:11}},title:{display:true,text:"m",color:"#747474",font:{family:"Inter, Arial",size:11,weight:"600"}}}}}}),
  ];
  reportHtml=`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relatório Terrock Flyrock</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root{--vale-gray:#77787B;--vale-yellow:#ECB833;--vale-turquoise:#00939A;--gray-50:#F2F4F4;--gray-100:#EEF1F1;--gray-200:#D9DDDD;--gray-400:#747474;--gray-500:#626366;--gray-700:#77787B;--gray-900:#77787B;--white:#FFFFFF;--border:#D9DDDD}
    *{box-sizing:border-box}
    body{margin:0;padding:24px;background:var(--gray-50);color:var(--gray-700);font-family:'Inter',Arial,sans-serif;line-height:1.5}
    .shell{max-width:1080px;margin:0 auto;background:var(--white);border:1px solid var(--border);overflow:hidden}
    .hero{padding:20px 24px;background:var(--vale-gray);color:var(--white);border-bottom:3px solid var(--vale-yellow)}
    .hero h1{margin:0 0 6px;font-size:20px;font-weight:700;letter-spacing:-0.02em}
    .hero p{margin:0;color:var(--gray-400);font-size:12px}
    .section{padding:20px 24px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border);border-bottom:1px solid var(--border)}
    .card{padding:14px;background:var(--white)}
    .card span{display:block;color:var(--gray-400);font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase}
    .card strong{display:block;margin-top:4px;color:var(--vale-turquoise);font-size:22px;line-height:1.05;font-weight:700}
    h2{margin:0 0 12px;font-size:15px;font-weight:700;color:var(--gray-900)}
    .table-wrap{overflow:auto;border:1px solid var(--border);background:var(--white)}
    table{width:100%;border-collapse:collapse;background:var(--white)}
    th,td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;text-align:left;vertical-align:middle}
    thead th{position:sticky;top:0;background:#EEF7F6;color:var(--vale-gray);font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;border-bottom:1px solid var(--gray-200)}
    tbody tr:hover{background:var(--gray-50)}
    tbody tr:last-child td{border-bottom:0}
    td.is-number{font-variant-numeric:tabular-nums;text-align:right}
    .notice{margin:0 24px 24px;padding:12px 16px;background:var(--gray-50);border:1px solid var(--border);border-left:3px solid var(--vale-yellow);color:var(--gray-500);font-size:11px}
    @media (max-width:900px){.cards{grid-template-columns:1fr 1fr}.section,.hero{padding-left:16px;padding-right:16px}}
    @media (max-width:620px){body{padding:12px}.cards{grid-template-columns:1fr}.hero h1{font-size:18px}}
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
      ${table(inverse,["litologia","lmax_atual_m","fonte_lmax","estado_adequacao","raio_atual_pessoas_m","lmax_permitido_m","tampao_atual_m","tampao_necessario_m","aumento_tampao_m","cme_atual_kg","cme_necessaria_kg","cme_com_tampao_kg","reducao_cme_pct","razao_carga_atual_kg_t","razao_carga_com_cme_kg_t","razao_carga_com_tampao_kg_t","alerta"])}
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
  syncContourProjection();
  if(contourGeo.length) return contourGeo.map(([lon,lat])=>[lon,lat]);
  const zone=n(document.getElementById("utmZone").value), hemi=document.getElementById("utmHemisphere").value;
  return contour.map(([x,y])=>utmToLatLon(x,y,zone,hemi));
}

function circleLonLat(radius,steps=96){
  syncContourProjection();
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
  const equipment=Number.isFinite(currentEquipmentRadius)?circleLonLat(currentEquipmentRadius):[];
  const poly=contourLonLat();
  return `<?xml version="1.0" encoding="UTF-8"?>
 <kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Zona de Segurança Flyrock</name>
<Style id="poly"><LineStyle><color>ff9a9300</color><width>3</width></LineStyle><PolyStyle><color>339a9300</color></PolyStyle></Style>
<Style id="people"><LineStyle><color>ff33b8ec</color><width>3</width></LineStyle><PolyStyle><color>3333b8ec</color></PolyStyle></Style>
<Style id="equip"><LineStyle><color>ff7b7877</color><width>2</width></LineStyle><PolyStyle><color>337b7877</color></PolyStyle></Style>
<Placemark><name>Poligonal do desmonte</name><styleUrl>#poly</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(poly.concat(poly[0] ? [poly[0]] : []))}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Raio pessoas ${fmt(currentRadius)} m</name><styleUrl>#people</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(people)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Raio equipamentos</name><styleUrl>#equip</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(equipment)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
}

function updateEquationPanel(valid,k,angle,ref,people,equipment,mode){
  document.getElementById("equationText").textContent="Lmax = (K² / g) × (CL / DS)^1,3 × sen²(θ); R = Lmax_ref × fator";
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
async function loadDefaultBlast(){
  // Exemplos reais extraídos da base processada a partir dos Excels e do relatório PDF.
  document.getElementById("blastName").value = "Exemplos da base";
  document.getElementById("kPreset").value = "10.1136915936";
  document.getElementById("kValue").value = "10.1136915936";
  document.getElementById("angleValue").value = "45";
  document.getElementById("peopleFactor").value = "4";
  document.getElementById("equipmentFactor").value = "2";
  document.getElementById("referenceMode").value = "max";
  holes=[];
  try {
    const response=await fetch("./data/exemplos_base.json");
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const baseRows=await response.json();
    baseRows.forEach(addHole);
  } catch(error) {
    console.warn("Não foi possível carregar os exemplos completos da base; usando amostra reduzida.",error);
    addHole({litologia:"CE",densidade_litologica_g_cm3:3.5,diametro_furo_pol:5.75,profundidade_m:9.6,afastamento_m:2.2,espacamento_m:4.4,tampao_real_m:3.1,carga_maxima_espera_kg:124,massa_desmontada_kt:325.24800000000005,razao_carga:0.3812475403384494});
    addHole({litologia:"HF",densidade_litologica_g_cm3:3.5,diametro_furo_pol:5.75,profundidade_m:9.0,afastamento_m:2.2,espacamento_m:4.4,tampao_real_m:2.9,carga_maxima_espera_kg:120,massa_desmontada_kt:304.9200000000001,razao_carga:0.3935458480913025});
    addHole({litologia:"HC",densidade_litologica_g_cm3:3.5,diametro_furo_pol:5.75,profundidade_m:10.0,afastamento_m:2.2,espacamento_m:4.4,tampao_real_m:3,carga_maxima_espera_kg:123,massa_desmontada_kt:338.80000000000007,razao_carga:0.3630460448642266});
  }
  run(true);
}

document.getElementById("sampleBtn").onclick=loadDefaultBlast;
document.getElementById("runBtn").onclick=run;
document.getElementById("downloadCsv").onclick=()=>download("base_furos_terrock.csv",csv(results),"text/csv;charset=utf-8");
document.getElementById("downloadReport").onclick=()=>download("relatorio_terrock_flyrock.html",reportHtml,"text/html;charset=utf-8");
document.getElementById("downloadKml").onclick=()=>download("zona_seguranca_google_earth.kml",buildKml(),"application/vnd.google-earth.kml+xml;charset=utf-8");
document.getElementById("openEarth").onclick=()=>{
  const geo=contourLonLat();
  if(!geo.length) return;
  const lon=mean(geo.map(([x])=>x)), lat=mean(geo.map(([,y])=>y));
  window.open(`https://earth.google.com/web/@${lat},${lon},800a,1200d,35y,0h,0t,0r`,"_blank");
};
document.getElementById("dxfFile").onchange=async e=>{const file=e.target.files[0]; if(!file)return; try{await importContourFile(file);}catch(err){document.getElementById("exampleStatus").textContent=err?.message || "Não foi possível importar o contorno.";}};
document.getElementById("loadFilesBtn").onclick=async()=>{
  const plan=document.getElementById("plansFile").files[0];
  const monitoring=document.getElementById("monitoringFile").files[0];
  if(!plan){document.getElementById("exampleStatus").textContent="Selecione o Excel do plano de fogo."; return;}
  try{
    const imported=workbookToHoles(await readWorkbook(plan));
    if(!imported.length) throw new Error("Não encontrei linhas de furos reconhecíveis no plano de fogo.");
    holes=imported; renderHoles(); run(true);
    document.getElementById("exampleStatus").textContent=monitoring ? `Plano carregado (${imported.length} registros). Monitoramento selecionado para a próxima integração.` : `Plano carregado (${imported.length} registros).`;
  }catch(err){document.getElementById("exampleStatus").textContent=err?.message || "Não foi possível importar os Excel.";}
};
document.getElementById("syncDatabaseBtn").onclick=async()=>{
  const url=document.getElementById("databaseUrl").value.trim();
  if(!url){document.getElementById("exampleStatus").textContent="Informe a URL do Apps Script da base."; return;}
  if(!results.length){document.getElementById("exampleStatus").textContent="Calcule o desmonte antes de salvar na base."; return;}
  try{
    const response=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({tipo:"desmonte",desmonte:document.getElementById("blastName").value,rows:results})});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const answer=await response.json();
    document.getElementById("exampleStatus").textContent=`Desmonte salvo na base (${answer.count || results.length} registros).`;
  }catch(err){document.getElementById("exampleStatus").textContent=`Não foi possível salvar na base: ${err?.message || "verifique a URL e as permissões"}.`;}
};
document.getElementById("kPreset").addEventListener("input",e=>{
  if(e.target.value !== "custom") document.getElementById("kValue").value = e.target.value;
  run(true);
});
document.getElementById("kValue").addEventListener("input",()=>{
  document.getElementById("kPreset").value = "custom";
  run(true);
});
["angleValue","peopleFactor","equipmentFactor","scenario1PeopleRadius","scenario1EquipmentRadius","scenario2PeopleRadius","scenario2EquipmentRadius","referenceMode"].forEach(id=>document.getElementById(id).addEventListener("input",()=>run(true)));
["dxfUnit"].forEach(id=>document.getElementById(id).addEventListener("input",()=>{
  if(dxfSourceText){
    contour=parseDxf(dxfSourceText,resolveDxfScale(dxfSourceText,document.getElementById("dxfUnit").value));
    if(!contour.length){ document.getElementById("exampleStatus").textContent="A unidade selecionada não gerou uma poligonal válida. Tente Automático ou outra unidade."; return; }
    document.getElementById("exampleStatus").textContent="Unidade DXF alterada e poligonal reprocessada.";
    renderSpatialStats();
  }
  viewBounds=null; drawMap();
}));
document.getElementById("showRadius").addEventListener("input",drawMap);
document.getElementById("utmZone").addEventListener("input",()=>{viewBounds=null; drawMap();});
document.getElementById("utmHemisphere").addEventListener("input",()=>{viewBounds=null; drawMap();});
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
    dxfSourceText=dxf;
    contour=parseDxf(dxf,resolveDxfScale(dxf,document.getElementById("dxfUnit").value));
    viewBounds=getInitialBounds();
    document.getElementById("exampleStatus").textContent="Exemplo carregado: poligonal de desmonte. Você pode substituir o DXF pelo seu arquivo.";
    renderSpatialStats();
    run(true);
  }catch(err){
    document.getElementById("exampleStatus").textContent="Não foi possível carregar o exemplo automaticamente. Use o campo de DXF para importar a poligonal.";
    const status=document.getElementById("calculationStatus");
    if(status) status.textContent="Aguardando um contorno válido";
  }
}

function readWorkbook(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>{try{resolve(XLSX.read(new Uint8Array(e.target.result),{type:"array"}));}catch(err){reject(err)}};
    reader.onerror=()=>reject(reader.error||new Error("Não foi possível ler o arquivo."));
    reader.readAsArrayBuffer(file);
  });
}

function workbookToHoles(workbook){
  const out=[];
  for(const name of workbook.SheetNames){
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:""});
    if(!rows.length) continue;
    const first=rows[0].map(v=>String(v).trim().toLowerCase());
    const headerRow=first.some(v=>/afast|espac|tamp|carga|profund/.test(v)) ? rows[0] : null;
    if(headerRow){
      const headers=headerRow.map(v=>String(v).trim().toLowerCase());
      for(const values of rows.slice(1)){
        const obj={}; headers.forEach((h,i)=>{obj[h]=values[i]});
        if(Object.values(obj).some(v=>String(v).trim()!=="")) out.push(normalizeImportedHole(obj,name));
      }
      continue;
    }
    const keys=rows.map(r=>String(r[0]??"").trim().toLowerCase());
    const aliases={litologia:["litologia","tipo de rocha"],densidade_litologica_g_cm3:["densidade","densidade litologica"],diametro_furo_pol:["diametro","diâmetro"],profundidade_m:["profundidade","prof"],afastamento_m:["afastamento","burden"],espacamento_m:["espacamento","espaçamento","spacing"],tampao_real_m:["tampao","tampão"],carga_maxima_espera_kg:["carga","cme","carga maxima"],massa_desmontada_kt:["massa","massa desmontada"]};
    const indexes={}; for(const [field,names] of Object.entries(aliases)){indexes[field]=keys.findIndex(k=>names.some(a=>k.includes(a)))}
    const max=Math.max(...rows.map(r=>r.length));
    for(let col=1;col<max;col++){const obj={}; for(const [field,row] of Object.entries(indexes)){if(row>=0)obj[field]=rows[row][col]}; if(Object.values(obj).some(v=>String(v??"").trim()!=="")) out.push(normalizeImportedHole(obj,name))}
  }
  return out;
}
function normalizeImportedHole(obj,name){
  const find=(patterns)=>{const key=Object.keys(obj).find(k=>patterns.some(p=>k.includes(p)));return key?obj[key]:""};
  return {litologia:find(["litologia","rocha"])||name,densidade_litologica_g_cm3:find(["densidade"]),diametro_furo_pol:find(["diametro","diâmetro"]),profundidade_m:find(["profundidade","prof"]),afastamento_m:find(["afastamento","burden"]),espacamento_m:find(["espacamento","espaçamento","spacing"]),tampao_real_m:find(["tampao","tampão"]),carga_maxima_espera_kg:find(["carga","cme"]),massa_desmontada_kt:find(["massa"]),razao_carga:find(["razao","razão"])};
}

loadDefaultBlast();
loadExampleAssets();
