import numpy as np
import pandas as pd

from src.features.units import safe_divide


def _series_or_nan(df: pd.DataFrame, column: str) -> pd.Series:
    if column in df.columns:
        return pd.to_numeric(df[column], errors="coerce")
    return pd.Series(np.nan, index=df.index, dtype=float)


def add_engineering_features(df: pd.DataFrame, use_real_stemming: bool = True, use_real_charge: bool = True) -> pd.DataFrame:
    """Add engineering features using the effective charge and stemming columns."""

    out = df.copy()
    tampao_source = "tampao_real_m"
    if not use_real_stemming and "tampao_programado_m" in out.columns:
        tampao_source = "tampao_programado_m"
    carga_source = "carga_realizada_kg"
    if not use_real_charge and "carga_programada_kg" in out.columns:
        carga_source = "carga_programada_kg"
    out["tampao_usado_m"] = _series_or_nan(out, tampao_source)
    out["carga_usada_kg"] = _series_or_nan(out, carga_source)
    out["fonte_tampao"] = tampao_source
    out["fonte_carga"] = carga_source
    out["densidade_litologica_t_m3"] = _series_or_nan(out, "densidade_litologica_g_cm3")
    out["profundidade_m"] = _series_or_nan(out, "profundidade_m")
    out["afastamento_m"] = _series_or_nan(out, "afastamento_m")
    out["espacamento_m"] = _series_or_nan(out, "espacamento_m")
    out["coluna_carregada_m"] = out["profundidade_m"] - out["tampao_usado_m"]
    out["carga_linear_kg_m"] = safe_divide(out["carga_usada_kg"], out["coluna_carregada_m"])
    out["area_malha_m2"] = out["afastamento_m"] * out["espacamento_m"]
    out["volume_estimado_m3"] = out["area_malha_m2"] * out["profundidade_m"]
    out["massa_estimativa_t"] = out["volume_estimado_m3"] * out["densidade_litologica_t_m3"]
    out["razao_carga_calculada_kg_t"] = safe_divide(out["carga_usada_kg"], out["massa_estimativa_t"])
    out["razao_tampao_profundidade"] = safe_divide(out["tampao_usado_m"], out["profundidade_m"])
    out["razao_afastamento_espacamento"] = out["afastamento_m"] / out["espacamento_m"]
    out["energia_relativa"] = safe_divide(out["carga_usada_kg"], out["tampao_usado_m"])
    out["indice_confinamento"] = safe_divide(out["tampao_usado_m"], out["carga_linear_kg_m"])
    out.replace([np.inf, -np.inf], np.nan, inplace=True)
    return out
