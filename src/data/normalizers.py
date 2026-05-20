import re
import unicodedata
from typing import Any

import pandas as pd

from src.features.units import to_numeric


PLAN_COLUMNS = {
    "desmonte": "desmonte",
    "litologia": "litologia",
    "densidade litologica g cm3": "densidade_litologica_g_cm3",
    "densidade litologica": "densidade_litologica_g_cm3",
    "o furo polegadas": "diametro_furo_pol",
    "furo polegadas": "diametro_furo_pol",
    "diametro furo polegadas": "diametro_furo_pol",
    "id furo": "id_furo",
    "profund m": "profundidade_m",
    "profundidade m": "profundidade_m",
    "afast m": "afastamento_m",
    "afastamento m": "afastamento_m",
    "espac m": "espacamento_m",
    "espacamento m": "espacamento_m",
    "tampao programado m": "tampao_programado_m",
    "tampao real m": "tampao_real_m",
    "carga programada kg": "carga_programada_kg",
    "carga realizado kg": "carga_realizada_kg",
    "carga realizada kg": "carga_realizada_kg",
    "massa desmontada kt": "massa_desmontada_kt",
    "razao de carga": "razao_carga",
}

MONITORING_COLUMNS = {
    "desmonte": "desmonte",
    "id furo": "id_furo",
    "distancia horizontal m": "distancia_horizontal_m",
    "velocidade inicial m s": "velocidade_inicial_m_s",
    "altura maxima m": "altura_maxima_m",
    "angle do trajeto": "angulo_trajeto_graus",
    "angulo do trajeto": "angulo_trajeto_graus",
}

NUMERIC_PLAN = [
    "densidade_litologica_g_cm3",
    "diametro_furo_pol",
    "profundidade_m",
    "afastamento_m",
    "espacamento_m",
    "tampao_programado_m",
    "tampao_real_m",
    "carga_programada_kg",
    "carga_realizada_kg",
    "massa_desmontada_kt",
    "razao_carga",
]
NUMERIC_MONITORING = ["distancia_horizontal_m", "velocidade_inicial_m_s", "altura_maxima_m", "angulo_trajeto_graus"]


def slug(value: Any) -> str:
    text = "" if pd.isna(value) else str(value)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.replace("Ø", "diametro").replace("ø", "diametro")
    text = re.sub(r"[^A-Za-z0-9]+", " ", text).strip().lower()
    return re.sub(r"\s+", " ", text)


def normalize_id(value: Any) -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    if re.fullmatch(r"\d+\.0", text):
        text = text[:-2]
    return text.upper()


def normalize_blast_sheet(df: pd.DataFrame, sheet_name: str) -> pd.DataFrame:
    raw = df.dropna(how="all").dropna(axis=1, how="all")
    if raw.empty:
        return pd.DataFrame()
    first_col = raw.columns[0]
    long = raw.set_index(first_col).T.reset_index(drop=True)
    long.columns = [PLAN_COLUMNS.get(slug(c), slug(c).replace(" ", "_")) for c in long.columns]
    long["sheet_name"] = sheet_name
    if "desmonte" not in long.columns or long["desmonte"].isna().all():
        long["desmonte"] = sheet_name
    for col in NUMERIC_PLAN:
        if col in long.columns:
            long[col] = to_numeric(long[col])
    if "id_furo" in long.columns:
        long["id_furo"] = long["id_furo"].map(normalize_id)
    long["desmonte"] = long["desmonte"].ffill().fillna(sheet_name).map(normalize_id)
    return long[[c for c in ["desmonte", "sheet_name", "id_furo", "litologia", *NUMERIC_PLAN] if c in long.columns]]


def normalize_monitoring(df: pd.DataFrame) -> pd.DataFrame:
    out = df.dropna(how="all").copy()
    out.columns = [MONITORING_COLUMNS.get(slug(c), slug(c).replace(" ", "_")) for c in out.columns]
    if "desmonte" in out.columns:
        out["desmonte"] = out["desmonte"].ffill().map(normalize_id)
    if "id_furo" in out.columns:
        out["id_furo"] = out["id_furo"].map(normalize_id)
    for col in NUMERIC_MONITORING:
        if col in out.columns:
            out[col] = to_numeric(out[col])
    return out[[c for c in ["desmonte", "id_furo", *NUMERIC_MONITORING] if c in out.columns]]
