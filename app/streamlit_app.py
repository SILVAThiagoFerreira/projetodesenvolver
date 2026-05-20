from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import streamlit as st

from src.config.settings import load_config
from src.pipeline import run_pipeline

st.set_page_config(page_title="Flyrock Modeling", layout="wide")
st.title("Modelo de Previsão de Flyrock")
st.caption("Ferramenta local de análise, simulação e relatório. Não substitui responsável técnico habilitado.")

config_path = st.sidebar.text_input("Arquivo YAML", "configs/default.yaml")
config = load_config(ROOT / config_path)

with st.sidebar:
    st.header("Parâmetros")
    config.model.k_calibration_method = st.selectbox("Calibração K", ["median", "mean", "trimmed_mean", "least_squares", "percentile"], index=0)
    config.model.group_by_lithology = st.checkbox("Usar K por litologia", value=config.model.group_by_lithology)
    config.safety.equipment_factor = st.number_input("Fator equipamentos", min_value=1.0, value=float(config.safety.equipment_factor))
    config.safety.people_factor = st.number_input("Fator pessoas", min_value=1.0, value=float(config.safety.people_factor))

st.subheader("Entrada de dados")
plans = st.file_uploader("Planos de fogo (.xlsx)", type=["xlsx"])
monitoring = st.file_uploader("Monitoramento (.xlsx)", type=["xlsx"])
if plans:
    path = ROOT / "data/raw/Apendice_I_Planos_de_fogo.xlsx"
    path.write_bytes(plans.getbuffer())
if monitoring:
    path = ROOT / "data/raw/Apendice_II_Banco_de_dados_monitoramento.xlsx"
    path.write_bytes(monitoring.getbuffer())

if st.button("Processar e gerar relatório", type="primary"):
    with st.spinner("Processando bases, calibrando modelo e gerando saídas..."):
        result = run_pipeline(config, ROOT)
    st.session_state["result"] = result
    st.success("Processamento concluído.")

result = st.session_state.get("result")
if result:
    tabs = st.tabs(["Validação", "Modelagem", "Simulações", "Relatório"])
    with tabs[0]:
        st.metric("Eventos", len(result["modeled"]))
        st.metric("Match (%)", round(result["match_report"]["percentual_match"], 2))
        st.dataframe(result["modeled"][["desmonte", "id_furo", "validation_status", "validation_errors", "is_outlier", "outlier_reason"]])
    with tabs[1]:
        st.metric("K global", round(float(result["k_global"]), 4))
        st.json(result["metrics"])
        st.dataframe(result["k_by_lithology"].reset_index(name="k") if len(result["k_by_lithology"]) else result["modeled"].head())
    with tabs[2]:
        st.dataframe(result["safety"])
        st.dataframe(result["inverse"])
    with tabs[3]:
        for label, path in {"HTML": result["html"], "PDF": result["pdf"], "DOCX": result["docx"]}.items():
            if path and Path(path).exists():
                st.download_button(f"Baixar {label}", Path(path).read_bytes(), file_name=Path(path).name)
