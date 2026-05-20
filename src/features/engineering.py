import numpy as np
import pandas as pd


def add_engineering_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["coluna_carregada_m"] = out["profundidade_m"] - out["tampao_real_m"]
    out["carga_linear_kg_m"] = out["carga_realizada_kg"] / out["coluna_carregada_m"]
    out["area_malha_m2"] = out["afastamento_m"] * out["espacamento_m"]
    out["volume_estimado_m3"] = out["area_malha_m2"] * out["profundidade_m"]
    out["massa_estimativa_t"] = out["volume_estimado_m3"] * out["densidade_litologica_g_cm3"]
    out["razao_carga_calculada_kg_t"] = out["carga_realizada_kg"] / out["massa_estimativa_t"]
    out["razao_tampao_profundidade"] = out["tampao_real_m"] / out["profundidade_m"]
    out["razao_afastamento_espacamento"] = out["afastamento_m"] / out["espacamento_m"]
    out["energia_relativa"] = out["carga_realizada_kg"] / out["tampao_real_m"]
    out.replace([np.inf, -np.inf], np.nan, inplace=True)
    return out
