const gravity = 9.80665;
let holes = [];
let results = [];
let contour = [];
let rasterStats = null;
let rasterPreview = null;
let currentRadius = NaN;
let charts = [];
let reportHtml = "";

const fields = [
  ["litologia","text","ITABIRITO"],["densidade_litologica_g_cm3","number","2.7"],["diametro_furo_pol","number","6.5"],
  ["id_furo","text","F001"],["profundidade_m","number","12"],["afastamento_m","number","4"],["espacamento_m","number","5"],
  ["tampao_programado_m","number","3.5"],["tampao_real_m","number","3.5"],["carga_programada_kg","number","180"],
  ["carga_realizada_kg","number","175"],["massa_desmontada_kt","number","0.001"],["razao_carga","number","0.75"]
];

function n(v){const x=Number(String(v ?? "").replace(",",".")); return Number.isFinite(x)?x:NaN}
function fmt(v,d=2){return Number.isFinite(v)?Number(v).toFixed(d):"-"}
function percentile(a,p){const x=a.filter(Number.isFinite).sort((u,v)=>u-v); if(!x.length)return NaN; const i=(x.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return x[lo]+(x[hi]-x[lo])*(i-lo)}
function mean(a){const x=a.filter(Number.isFinite); return x.length?x.reduce((s,v)=>s+v,0)/x.length:NaN}
function terrockLmax(k,cl,ds,angle){return (k*k/gravity)*Math.pow(Math.sqrt(cl)/Math.sqrt(ds),2.6)*Math.pow(Math.sin(angle*Math.PI/180),2)}
function csv(rows){const keys=Object.keys(rows[0]||{}); return [keys.join(";"),...rows.map(r=>keys.map(k=>String(r[k]??"").replaceAll(";"," ")).join(";"))].join("\n")}
function download(name,content,type){const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click()}

function addHole(seed={}){
  const row = Object.fromEntries(fields.map(([key,,def]) => [key, seed[key] ?? def]));
  holes.push(row);
  renderHoles();
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
      if(key==="id_furo") input.className="id"; if(key==="litologia") input.className="lito";
      input.oninput=()=>{holes[idx][key]=input.value; run(true)};
      td.appendChild(input); tr.appendChild(td);
    });
    const td=document.createElement("td"); const btn=document.createElement("button"); btn.textContent="Remover"; btn.className="remove";
    btn.onclick=()=>{holes.splice(idx,1); renderHoles()}; td.appendChild(btn); tr.appendChild(td); tbody.appendChild(tr);
  });
}

function validateAndCompute(h,k,angle){
  const r={...h};
  ["densidade_litologica_g_cm3","diametro_furo_pol","profundidade_m","afastamento_m","espacamento_m","tampao_programado_m","tampao_real_m","carga_programada_kg","carga_realizada_kg","massa_desmontada_kt","razao_carga"].forEach(c=>r[c]=n(r[c]));
  const errors=[];
  if(!r.litologia) errors.push("litologia vazia");
  if(!r.id_furo) errors.push("id_furo vazio");
  if(!(r.profundidade_m>0)) errors.push("profundidade invalida");
  if(!(r.tampao_real_m>0)) errors.push("tampao real invalido");
  if(!(r.tampao_real_m<r.profundidade_m)) errors.push("tampao deve ser menor que profundidade");
  if(!(r.carga_realizada_kg>0)) errors.push("carga realizada invalida");
  if(!(r.afastamento_m>0)) errors.push("afastamento invalido");
  if(!(r.espacamento_m>0)) errors.push("espacamento invalido");
  if(!(angle>0 && angle<90)) errors.push("angulo invalido");
  r.validation_errors=errors.join("; ");
  r.validation_status=errors.length?"invalid":"valid";
  if(!errors.length){
    r.coluna_carregada_m=r.profundidade_m-r.tampao_real_m;
    r.carga_linear_kg_m=r.carga_realizada_kg/r.coluna_carregada_m;
    r.area_malha_m2=r.afastamento_m*r.espacamento_m;
    r.volume_estimado_m3=r.area_malha_m2*r.profundidade_m;
    r.massa_estimativa_t=r.volume_estimado_m3*r.densidade_litologica_g_cm3;
    r.razao_carga_calculada_kg_t=r.carga_realizada_kg/r.massa_estimativa_t;
    r.razao_tampao_profundidade=r.tampao_real_m/r.profundidade_m;
    r.energia_relativa=r.carga_realizada_kg/r.tampao_real_m;
    r.lmax_previsto_m=terrockLmax(k,r.carga_linear_kg_m,r.tampao_real_m,angle);
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
      id_furo:r.id_furo, litologia:r.litologia, lmax_atual_m:r.lmax_previsto_m, raio_atual_pessoas_m:r.raio_pessoas_m,
      raio_alvo_pessoas_m:target, lmax_permitido_m:allowed, tampao_atual_m:r.tampao_real_m,
      tampao_necessario_m:tampaoNec, aumento_tampao_m:Math.max(0,tampaoNec-r.tampao_real_m),
      carga_atual_kg:r.carga_realizada_kg, carga_necessaria_kg:cargaNec,
      reducao_carga_pct:Math.max(0,(1-cargaNec/r.carga_realizada_kg)*100),
      alerta:tampaoNec<r.profundidade_m && cargaNec>0 ? "viavel como triagem" : "requer redesenho tecnico"
    };
  });
}

function parseDxf(text,scale){
  const lines=text.replace(/\r/g,"").split("\n").map(s=>s.trim());
  const pts=[];
  for(let i=0;i<lines.length-1;i++){
    if(lines[i]==="10" && /^-?\d/.test(lines[i+1])){
      const x=n(lines[i+1])*scale;
      let y=NaN;
      for(let j=i+2;j<Math.min(i+8,lines.length-1);j++){
        if(lines[j]==="20"){y=n(lines[j+1])*scale; break}
      }
      if(Number.isFinite(x)&&Number.isFinite(y)) pts.push([x,y]);
    }
  }
  return pts;
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
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle="#f9fbfb"; ctx.fillRect(0,0,canvas.width,canvas.height);
  if(rasterPreview) ctx.drawImage(rasterPreview,0,0,canvas.width,canvas.height);
  if(!contour.length) return;
  const st=polygonStats(contour), [cx,cy]=centroid(contour), radius=Number.isFinite(currentRadius)?currentRadius:0, pad=30;
  const minX=Math.min(st.min_x,cx-radius), maxX=Math.max(st.max_x,cx+radius), minY=Math.min(st.min_y,cy-radius), maxY=Math.max(st.max_y,cy+radius);
  const sx=(canvas.width-2*pad)/(maxX-minX||1), sy=(canvas.height-2*pad)/(maxY-minY||1), s=Math.min(sx,sy);
  const px=x=>pad+(x-minX)*s, py=y=>canvas.height-pad-(y-minY)*s;
  if(radius>0){
    ctx.beginPath(); ctx.arc(px(cx),py(cy),radius*s,0,Math.PI*2);
    ctx.fillStyle="rgba(118,188,33,.10)"; ctx.fill(); ctx.strokeStyle="#76bc21"; ctx.lineWidth=2; ctx.setLineDash([8,5]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath(); contour.forEach(([x,y],i)=>{if(i)ctx.lineTo(px(x),py(y)); else ctx.moveTo(px(x),py(y))}); ctx.closePath();
  ctx.fillStyle="rgba(0,126,122,.18)"; ctx.fill(); ctx.strokeStyle="#007e7a"; ctx.lineWidth=3; ctx.stroke();
  ctx.beginPath(); ctx.arc(px(cx),py(cy),4,0,Math.PI*2); ctx.fillStyle="#003c46"; ctx.fill();
  ctx.fillStyle="#003c46"; ctx.font="12px Arial"; ctx.fillText(`Raio pessoas: ${fmt(currentRadius)} m`, px(cx)+8, py(cy)-8);
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
  await readGeoTiffBuffer(arrayBuffer);
}

async function readGeoTiffBuffer(arrayBuffer){
  const tiff=await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image=await tiff.getImage();
  const raster=await image.readRasters({samples:[0]});
  const data=raster[0]; let min=Infinity,max=-Infinity,sum=0,count=0;
  const step=Math.max(1,Math.floor(data.length/250000));
  for(let i=0;i<data.length;i+=step){const v=Number(data[i]); if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);sum+=v;count++;}}
  rasterStats={min,max,mean:sum/count,count,width:image.getWidth(),height:image.getHeight()};
  const w=image.getWidth(), h=image.getHeight(), preview=document.createElement("canvas"), maxSide=700, scale=Math.min(1,maxSide/Math.max(w,h));
  preview.width=Math.max(1,Math.floor(w*scale)); preview.height=Math.max(1,Math.floor(h*scale));
  const pctx=preview.getContext("2d"), img=pctx.createImageData(preview.width,preview.height);
  for(let y=0;y<preview.height;y++){
    for(let x=0;x<preview.width;x++){
      const srcX=Math.floor(x/scale), srcY=Math.floor(y/scale), v=Number(data[srcY*w+srcX]);
      const t=Number.isFinite(v) && max>min ? (v-min)/(max-min) : 0;
      const shade=Math.max(40,Math.min(235,Math.round(235-t*145)));
      const idx=(y*preview.width+x)*4; img.data[idx]=shade-20; img.data[idx+1]=shade; img.data[idx+2]=shade-15; img.data[idx+3]=255;
    }
  }
  pctx.putImageData(img,0,0); rasterPreview=preview;
  renderSpatialStats();
  drawMap();
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
  const resultKeys=["id_furo","litologia","coluna_carregada_m","carga_linear_kg_m","razao_tampao_profundidade","lmax_previsto_m","raio_equipamentos_m","raio_pessoas_m","validation_status","validation_errors"];
  document.getElementById("resultsTable").innerHTML=table(results,resultKeys);
  const inverse=inverseRows(valid,k,angle,n(document.getElementById("targetRadius").value),people);
  document.getElementById("inverseTable").innerHTML=table(inverse,["id_furo","litologia","lmax_atual_m","raio_atual_pessoas_m","lmax_permitido_m","tampao_necessario_m","aumento_tampao_m","carga_necessaria_kg","reducao_carga_pct","alerta"]);
  drawMap();
  charts.forEach(c=>c.destroy());
  charts=[
    new Chart(document.getElementById("lmaxChart"),{type:"bar",data:{labels:valid.map(r=>r.id_furo),datasets:[{label:"Lmax previsto (m)",data:lmax,backgroundColor:"#007e7a"}]},options:{plugins:{legend:{display:false}}}}),
    new Chart(document.getElementById("stemmingChart"),{type:"scatter",data:{datasets:[{label:"Lmax x tampão",data:valid.map(r=>({x:r.tampao_real_m,y:r.lmax_previsto_m}))}]},options:{scales:{x:{title:{display:true,text:"Tampão real (m)"}},y:{title:{display:true,text:"Lmax (m)"}}}}})
  ];
  reportHtml=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body><h1>Relatório Terrock Flyrock</h1><p>Desmonte: ${document.getElementById("blastName").value}. K=${k}. Ângulo=${angle}°. Lmax referência=${fmt(ref)} m. Raio pessoas=${fmt(ref*people)} m.</p><p>Ferramenta de apoio técnico; não substitui responsável técnico habilitado.</p><h2>Resultados</h2>${table(results,resultKeys)}<h2>Desenho inverso</h2>${table(inverse,["id_furo","litologia","lmax_atual_m","raio_atual_pessoas_m","lmax_permitido_m","tampao_necessario_m","carga_necessaria_kg","alerta"])}</body></html>`;
  document.getElementById("downloadCsv").disabled=false; document.getElementById("downloadReport").disabled=false;
}

document.getElementById("addHoleBtn").onclick=()=>addHole({id_furo:`F${String(holes.length+1).padStart(3,"0")}`});
document.getElementById("sampleBtn").onclick=()=>{holes=[]; addHole({id_furo:"F001",litologia:"SULFETO",densidade_litologica_g_cm3:2.8,profundidade_m:12,tampao_real_m:4.1,carga_realizada_kg:170}); addHole({id_furo:"F002",litologia:"OXIDADO",densidade_litologica_g_cm3:2.4,profundidade_m:10,tampao_real_m:5,carga_realizada_kg:135});};
document.getElementById("runBtn").onclick=run;
document.getElementById("downloadCsv").onclick=()=>download("base_furos_terrock.csv",csv(results),"text/csv;charset=utf-8");
document.getElementById("downloadReport").onclick=()=>download("relatorio_terrock_flyrock.html",reportHtml,"text/html;charset=utf-8");
document.getElementById("dxfFile").onchange=async e=>{const file=e.target.files[0]; if(!file)return; contour=parseDxf(await file.text(),n(document.getElementById("dxfUnit").value)); drawMap(); renderSpatialStats();};
document.getElementById("geotiffFile").onchange=async e=>{const file=e.target.files[0]; if(file) await readGeoTiff(file);};
["kValue","angleValue","peopleFactor","equipmentFactor","targetRadius","referenceMode","dxfUnit"].forEach(id=>document.getElementById(id).addEventListener("input",()=>run(true)));

async function loadExampleAssets(){
  try{
    const [tif,dxf]=await Promise.all([
      fetch("./assets/examples/curvas-de-nivel.tif").then(r=>r.arrayBuffer()),
      fetch("./assets/examples/plano-de-perfuracao.dxf").then(r=>r.text())
    ]);
    await readGeoTiffBuffer(tif);
    contour=parseDxf(dxf,n(document.getElementById("dxfUnit").value));
    document.getElementById("exampleStatus").textContent="Exemplo carregado: curvas de nível e plano de perfuração. Você pode substituir os arquivos acima.";
    renderSpatialStats();
    run(true);
  }catch(err){
    document.getElementById("exampleStatus").textContent="Não foi possível carregar o exemplo automaticamente. Use os campos acima para importar GeoTIFF e DXF.";
  }
}

addHole();
loadExampleAssets();
