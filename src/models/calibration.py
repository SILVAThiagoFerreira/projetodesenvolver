import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.stats import trim_mean

from src.models.terrock import terrock_lmax


def _calibrate_series(frame: pd.DataFrame, method: str, percentile: float = 95, gravity: float = 9.80665) -> float:
    k_values = pd.to_numeric(frame["k_evento"], errors="coerce").dropna()
    if k_values.empty:
        return float("nan")
    if method == "mean":
        return float(k_values.mean())
    if method == "trimmed_mean":
        return float(trim_mean(k_values, 0.1))
    if method == "percentile":
        return float(np.percentile(k_values, percentile))
    if method == "least_squares":
        def objective(k: float) -> float:
            pred = terrock_lmax(k, frame["carga_linear_kg_m"], frame["tampao_real_m"], frame["angulo_trajeto_graus"], gravity)
            return float(np.nanmean((pred - frame["distancia_horizontal_m"]) ** 2))
        result = minimize_scalar(objective, bounds=(0.01, max(500.0, k_values.max() * 5)), method="bounded")
        return float(result.x)
    return float(k_values.median())


def calibrate_k(data: pd.DataFrame, method: str = "median", group_by: str | None = None, percentile: float = 95, gravity: float = 9.80665) -> float | pd.Series:
    if group_by:
        return data.groupby(group_by, dropna=False).apply(lambda g: _calibrate_series(g, method, percentile, gravity))
    return _calibrate_series(data, method, percentile, gravity)
