from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.stats import trim_mean

from src.models.terrock import terrock_lmax


def _numeric_k_values(frame: pd.DataFrame) -> pd.Series:
    if "k_evento" not in frame.columns:
        return pd.Series(dtype=float)
    return pd.to_numeric(frame["k_evento"], errors="coerce").dropna()


def _calibrate_series(frame: pd.DataFrame, method: str, percentile: float = 95, gravity: float = 9.80665) -> float:
    k_values = _numeric_k_values(frame)
    if k_values.empty:
        return float("nan")
    stemming_col = "tampao_usado_m" if "tampao_usado_m" in frame.columns else "tampao_real_m"
    if method == "mean":
        return float(k_values.mean())
    if method == "trimmed_mean":
        return float(trim_mean(k_values, 0.1))
    if method == "percentile":
        return float(np.percentile(k_values, percentile))
    if method == "least_squares":
        valid = frame[[c for c in ["carga_linear_kg_m", stemming_col, "angulo_trajeto_graus", "distancia_horizontal_m"] if c in frame.columns]].dropna()
        if valid.empty:
            return float("nan")

        def objective(k: float) -> float:
            pred = terrock_lmax(k, valid["carga_linear_kg_m"], valid[stemming_col], valid["angulo_trajeto_graus"], gravity)
            return float(np.nanmean((pd.to_numeric(pred, errors="coerce") - valid["distancia_horizontal_m"]) ** 2))

        result = minimize_scalar(objective, bounds=(0.01, max(500.0, k_values.max() * 5)), method="bounded")
        return float(result.x)
    return float(k_values.median())


def calibrate_k(data: pd.DataFrame, method: str = "median", group_by: str | None = None, percentile: float = 95, gravity: float = 9.80665) -> float | pd.Series:
    """Calibrate Terrock K from per-event values.

    Returns a scalar when `group_by` is None, otherwise a Series indexed by the grouping key.
    """

    if data.empty:
        return float("nan") if group_by is None else pd.Series(dtype=float)
    if group_by:
        return data.groupby(group_by, dropna=False).apply(lambda g: _calibrate_series(g, method, percentile, gravity))
    return _calibrate_series(data, method, percentile, gravity)


def rank_k_influencers(data: pd.DataFrame, center: float | None = None, top_n: int = 10) -> pd.DataFrame:
    """Rank events by absolute deviation from the calibrated K center."""

    if data.empty or "k_evento" not in data.columns:
        return pd.DataFrame()
    values = pd.to_numeric(data["k_evento"], errors="coerce")
    center = float(values.median()) if center is None else float(center)
    out = data.copy()
    out["k_desvio"] = values - center
    out["k_desvio_abs"] = out["k_desvio"].abs()
    cols = [c for c in ["desmonte", "id_furo", "litologia", "k_evento", "k_desvio", "k_desvio_abs", "distancia_horizontal_m"] if c in out.columns]
    return out.sort_values("k_desvio_abs", ascending=False)[cols].head(top_n).reset_index(drop=True)


def calibration_summary(data: pd.DataFrame, method: str = "median", group_by: str | None = None, percentile: float = 95, gravity: float = 9.80665) -> dict[str, object]:
    """Return a compact, auditable summary of K calibration."""

    if data.empty or "k_evento" not in data.columns:
        return {
            "method": method,
            "n_eventos": 0,
            "k_calibrado": float("nan"),
            "weak_sample": True,
            "faixa_provavel": [float("nan"), float("nan")],
            "groups": [],
            "rankings": [],
        }
    values = _numeric_k_values(data)
    k_calibrado = calibrate_k(data, method, group_by, percentile, gravity)
    summary = {
        "method": method,
        "n_eventos": int(len(values)),
        "k_calibrado": None if isinstance(k_calibrado, pd.Series) else float(k_calibrado),
        "media": float(values.mean()) if not values.empty else float("nan"),
        "mediana": float(values.median()) if not values.empty else float("nan"),
        "desvio_padrao": float(values.std()) if len(values) > 1 else float("nan"),
        "q05": float(values.quantile(0.05)) if len(values) else float("nan"),
        "q25": float(values.quantile(0.25)) if len(values) else float("nan"),
        "q75": float(values.quantile(0.75)) if len(values) else float("nan"),
        "q95": float(values.quantile(0.95)) if len(values) else float("nan"),
        "faixa_provavel": [float(values.quantile(0.05)) if len(values) else float("nan"), float(values.quantile(0.95)) if len(values) else float("nan")],
        "weak_sample": int(len(values)) < 5,
    }
    if group_by and group_by in data.columns:
        groups = []
        for group_name, group_df in data.groupby(group_by, dropna=False):
            group_values = _numeric_k_values(group_df)
            groups.append(
                {
                    group_by: group_name,
                    "n_eventos": int(len(group_values)),
                    "k_calibrado": float(_calibrate_series(group_df, method, percentile, gravity)) if len(group_values) else float("nan"),
                    "weak_sample": int(len(group_values)) < 5,
                    "faixa_provavel": [
                        float(group_values.quantile(0.05)) if len(group_values) else float("nan"),
                        float(group_values.quantile(0.95)) if len(group_values) else float("nan"),
                    ],
                }
            )
        summary["groups"] = groups
    else:
        summary["groups"] = []
    summary["rankings"] = rank_k_influencers(data, center=float(values.median()) if not values.empty else None).to_dict("records")
    return summary
