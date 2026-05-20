import numpy as np
import pandas as pd


def terrock_lmax(k: float | pd.Series, carga_linear_kg_m: pd.Series, tampao_m: pd.Series, angulo_graus: pd.Series, gravity: float = 9.80665) -> pd.Series:
    theta = np.deg2rad(angulo_graus.astype(float))
    base = (np.sqrt(carga_linear_kg_m.astype(float)) / np.sqrt(tampao_m.astype(float))) ** 2.6
    return ((k**2) / gravity) * base * (np.sin(theta) ** 2)


def calculate_k_event(lmax_observado_m: pd.Series, carga_linear_kg_m: pd.Series, tampao_m: pd.Series, angulo_graus: pd.Series, gravity: float = 9.80665) -> pd.Series:
    theta = np.deg2rad(angulo_graus.astype(float))
    denominator = ((np.sqrt(carga_linear_kg_m.astype(float)) / np.sqrt(tampao_m.astype(float))) ** 2.6) * (np.sin(theta) ** 2)
    return np.sqrt((lmax_observado_m.astype(float) * gravity) / denominator)


def add_terrock_results(df: pd.DataFrame, k: float | pd.Series, gravity: float = 9.80665) -> pd.DataFrame:
    out = df.copy()
    out["k_evento"] = calculate_k_event(out["distancia_horizontal_m"], out["carga_linear_kg_m"], out["tampao_real_m"], out["angulo_trajeto_graus"], gravity)
    out["lmax_previsto_m"] = terrock_lmax(k, out["carga_linear_kg_m"], out["tampao_real_m"], out["angulo_trajeto_graus"], gravity)
    out["erro_m"] = out["lmax_previsto_m"] - out["distancia_horizontal_m"]
    out["erro_abs_m"] = out["erro_m"].abs()
    out["erro_percentual"] = out["erro_m"] / out["distancia_horizontal_m"] * 100
    return out
