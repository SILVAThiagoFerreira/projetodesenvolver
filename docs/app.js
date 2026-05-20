const g = 9.80665;
let processed = [];
let reportHtml = "";
let charts = [];

const aliases = {
  "desmonte": "desmonte", "litologia": "litologia", "densidade litologica g cm3": "densidade_litologica_g_cm3",
  "o furo polegadas": "diametro_furo_pol", "furo polegadas": "diametro_furo_pol", "id furo": "id_furo",
  "profund m": "profundidade_m", "profundidade m": "profundidade_m", "afast m": "afastamento_m",
  "afastamento m": "afastamento_m", "espac m": "espacamento_m", "espacamento m": "espacamento_m",
  "tampao programado m": "tampao_programado_m", "tampao real m": "tampao_real_m",
  "carga programada kg": "carga_programada_kg", "carga realizado kg": "carga_realizada_kg",
  "carga realizada kg": "carga_realizada_kg", "massa desmontada kt": "massa_desmontada_kt", "razao de carga": "razao_carga",
  "distancia horizontal m": "distancia_horizontal_m", "velocidade inicial m s": "velocidade_inicial_m_s",
  "altura maxima m": "altura_maxima_m", "angle do trajeto": "angulo_trajeto_graus", "angulo do trajeto": "angulo_trajeto_graus"
};
const numericCols = ["densidade_litologica_g_cm3","diametro_furo_pol","profundidade_m","afastamento_m","espacamento_m","tampao_programado_m","tampao_real_m","carga_programada_kg","carga_realizada_kg","massa_desmontada_kt","razao_carga","distancia_horizontal_m","velocidade_inicial_m_s","altura_maxima_m","angulo_trajeto_graus"];

function slug(v){return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9]+/g," ").trim().toLowerCase().replace(/\s+/g," ")}
function normId(v){if(v===null||v===undefined||v==="")return ""; return String(v).replace(/\.0$/,"").trim().toUpperCase()}
function num(v){if(v===null||v===undefined||v==="")return NaN; return Number(String(v).replace(",","."))}
function median(a){const x=a.filter(Number.isFinite).sort((p,q)=>p-q); if(!x.length)return NaN; const m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2}
function percentile(a,p){const x=a.filter(Number.isFinite).sort((p,q)=>p-q); if(!x.length)return NaN; const i=(x.length-1)*p; const lo=Math.floor(i), hi=Math.ceil(i); return x[lo]+(x[hi]-x[lo])*(i-lo)}
function mean(a){const x=a.filter(Number.isFinite); return x.reduce((s,v)=>s+v,0)/x.length}
function lmax(k,cl,ds,angle){return (k*k/g)*Math.pow(Math.sqrt(cl)/Math.sqrt(ds),2.6)*Math.pow(Math.sin(angle*Math.PI/180),2)}
function kEvent(l,cl,ds,angle){const den=Math.pow(Math.sqrt(cl)/Math.sqrt(ds),2.6)*Math.pow(Math.sin(angle*Math.PI/180),2); return Math.sqrt(l*g/den)}

async function readWorkbook(file){const data=await file.arrayBuffer(); return XLSX.read(data,{type:"array"})}
function normalizeBlast(wb){
  const rows=[];
  wb.SheetNames.filter(n=>n.toLowerCase().startsWith("fogo")).forEach(sheet=>{
    const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:null}).filter(r=>r.some(c=>c!==null&&c!==""));
    if(!aoa.length)return;
    const vars=aoa.map(r=>aliases[slug(r[0])] || slug(r[0]).replaceAll(" ","_"));
    const maxCols=Math.max(...aoa.map(r=>r.length));
    for(let c=1;c<maxCols;c++){
      const obj={sheet_name:sheet};
      vars.forEach((name,r)=>obj[name]=aoa[r][c]);
      obj.desmonte=normId(obj.desmonte || sheet); obj.id_furo=normId(obj.id_furo);
      numericCols.forEach(col=>{if(col in obj)obj[col]=num(obj[col])});
      if(obj.id_furo)rows.push(obj);
    }
  });
  return rows;
}
function normalizeMonitoring(wb){
  const sheet=wb.Sheets["BD_Geral"] || wb.Sheets[wb.SheetNames[0]];
  const json=XLSX.utils.sheet_to_json(sheet,{defval:null});
  let last="";
  return json.map(row=>{
    const obj={}; Object.entries(row).forEach(([k,v])=>obj[aliases[slug(k)] || slug(k).replaceAll(" ","_")]=v);
    if(obj.desmonte) last=normId(obj.desmonte); obj.desmonte=last; obj.id_furo=normId(obj.id_furo);
    numericCols.forEach(col=>{if(col in obj)obj[col]=num(obj[col])});
    return obj;
  }).filter(r=>r.desmonte&&r.id_furo);
}
function validate(r){
  const e=[];
  [["profundidade_m",v=>v>0],["tampao_real_m",v=>v>0],["carga_realizada_kg",v=>v>0],["distancia_horizontal_m",v=>v>0],["angulo_trajeto_graus",v=>v>0&&v<90],["afastamento_m",v=>v>0],["espacamento_m",v=>v>0]].forEach(([c,fn])=>{if(!fn(r[c]))e.push(`${c} invalido`)});
  if(!(r.tampao_real_m<r.profundidade_m))e.push("tampao_real_m deve ser menor que profundidade_m");
  ["litologia","desmonte","id_furo"].forEach(c=>{if(!r[c])e.push(`${c} vazio`)});
  r.validation_errors=e.join("; "); r.validation_status=e.length?"invalid":"valid"; return r;
}
function engineer(r){
  r.coluna_carregada_m=r.profundidade_m-r.tampao_real_m; r.carga_linear_kg_m=r.carga_realizada_kg/r.coluna_carregada_m;
  r.area_malha_m2=r.afastamento_m*r.espacamento_m; r.volume_estimado_m3=r.area_malha_m2*r.profundidade_m;
  r.massa_estimativa_t=r.volume_estimado_m3*r.densidade_litologica_g_cm3; r.razao_carga_calculada_kg_t=r.carga_realizada_kg/r.massa_estimativa_t;
  r.razao_tampao_profundidade=r.tampao_real_m/r.profundidade_m; r.energia_relativa=r.carga_realizada_kg/r.tampao_real_m; return r;
}
function table(rows, limit=50){if(!rows.length)return "<p>Sem dados.</p>"; const keys=Object.keys(rows[0]); return `<table><thead><tr>${keys.map(k=>`<th>${k}</th>`).join("")}</tr></thead><tbody>${rows.slice(0,limit).map(r=>`<tr>${keys.map(k=>`<td>${Number.isFinite(r[k])?Number(r[k]).toFixed(2):String(r[k]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table>`}
function download(name, content, type){const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click()}
function csv(rows){const keys=Object.keys(rows[0]||{}); return [keys.join(";"),...rows.map(r=>keys.map(k=>String(r[k]??"").replaceAll(";"," ")).join(";"))].join("\n")}

document.getElementById("runBtn").onclick=async()=>{
  const blastFile=document.getElementById("blastFile").files[0], monitoringFile=document.getElementById("monitoringFile").files[0];
  if(!blastFile||!monitoringFile){alert("Selecione os dois arquivos Excel."); return}
  const [blastWb,monWb]=await Promise.all([readWorkbook(blastFile),readWorkbook(monitoringFile)]);
  const plans=normalizeBlast(blastWb), mon=normalizeMonitoring(monWb), planMap=new Map(plans.map(p=>[`${p.desmonte}|${p.id_furo}`,p]));
  processed=mon.map(m=>validate(engineer({...m,...(planMap.get(`${m.desmonte}|${m.id_furo}`)||{})})));
  processed.forEach(r=>{if(r.validation_status==="valid")r.k_evento=kEvent(r.distancia_horizontal_m,r.carga_linear_kg_m,r.tampao_real_m,r.angulo_trajeto_graus)});
  const kvals=processed.map(r=>r.k_evento); const method=document.getElementById("kMethod").value;
  const k=method==="mean"?mean(kvals):method==="p75"?percentile(kvals,.75):method==="p90"?percentile(kvals,.90):method==="p95"?percentile(kvals,.95):median(kvals);
  processed.forEach(r=>{if(r.validation_status==="valid"){r.lmax_previsto_m=lmax(k,r.carga_linear_kg_m,r.tampao_real_m,r.angulo_trajeto_graus); r.erro_m=r.lmax_previsto_m-r.distancia_horizontal_m; r.erro_abs_m=Math.abs(r.erro_m); r.erro_percentual=r.erro_m/r.distancia_horizontal_m*100}});
  const matched=processed.filter(r=>r.litologia).length, invalid=processed.filter(r=>r.validation_status==="invalid").length;
  document.getElementById("events").textContent=processed.length; document.getElementById("match").textContent=`${(matched/processed.length*100).toFixed(1)}%`; document.getElementById("kGlobal").textContent=k.toFixed(3); document.getElementById("invalid").textContent=invalid;
  const eq=Number(document.getElementById("equipmentFactor").value), pe=Number(document.getElementById("peopleFactor").value), pred=processed.map(r=>r.lmax_previsto_m).filter(Number.isFinite);
  const safety=[["maximo_previsto",Math.max(...pred)],["p90_previsto",percentile(pred,.9)],["p95_previsto",percentile(pred,.95)]].map(([cenario,l])=>({cenario,lmax_referencia_m:l,raio_equipamentos_m:l*eq,raio_pessoas_m:l*pe}));
  document.getElementById("safetyTable").innerHTML=table(safety);
  const inverse=[]; processed.filter(r=>r.validation_status==="valid").slice(0,100).forEach(r=>[600,500].forEach(target=>{const allowed=target/pe, ratio=allowed/r.lmax_previsto_m, tamp=r.tampao_real_m/Math.pow(ratio,1/1.3), cl=r.carga_linear_kg_m*Math.pow(ratio,1/1.3), carga=cl*r.coluna_carregada_m; inverse.push({desmonte:r.desmonte,id_furo:r.id_furo,raio_alvo_pessoas_m:target,lmax_permitido_m:allowed,lmax_previsto_atual_m:r.lmax_previsto_m,tampao_necessario_m:tamp,carga_necessaria_kg:carga,reducao_carga_pct:Math.max(0,(1-carga/r.carga_realizada_kg)*100),alerta:tamp<r.profundidade_m?"viavel como triagem":"requer redesenho tecnico"})}));
  document.getElementById("inverseTable").innerHTML=table(inverse,30);
  charts.forEach(c=>c.destroy()); charts=[
    new Chart(document.getElementById("obsPredChart"),{type:"scatter",data:{datasets:[{label:"Observado x previsto",data:processed.filter(r=>Number.isFinite(r.lmax_previsto_m)).map(r=>({x:r.distancia_horizontal_m,y:r.lmax_previsto_m}))}]},options:{scales:{x:{title:{display:true,text:"Observado m"}},y:{title:{display:true,text:"Previsto m"}}}}}),
    new Chart(document.getElementById("kChart"),{type:"bar",data:{labels:processed.filter(r=>Number.isFinite(r.k_evento)).map(r=>r.id_furo),datasets:[{label:"K evento",data:processed.filter(r=>Number.isFinite(r.k_evento)).map(r=>r.k_evento)}]},options:{plugins:{legend:{display:false}}}})
  ];
  reportHtml=`<html><meta charset="utf-8"><body><h1>Relatório Flyrock</h1><p>K global: ${k.toFixed(4)}. Eventos: ${processed.length}. Match: ${(matched/processed.length*100).toFixed(1)}%.</p><p>Ferramenta de apoio técnico. Não substitui responsável técnico habilitado.</p><h2>Raios</h2>${table(safety)}<h2>Cenários</h2>${table(inverse,100)}</body></html>`;
  document.getElementById("downloadCsv").disabled=false; document.getElementById("downloadReport").disabled=false;
};
document.getElementById("downloadCsv").onclick=()=>download("base_modelagem.csv",csv(processed),"text/csv;charset=utf-8");
document.getElementById("downloadReport").onclick=()=>download("relatorio_flyrock.html",reportHtml,"text/html;charset=utf-8");
