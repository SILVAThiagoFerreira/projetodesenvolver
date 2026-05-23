from __future__ import annotations

import numpy as np
import pandas as pd

from src.models.terrock import terrock_lmax


def _clamp_angle(series: pd.Series) -> pd.Series:
    return series.clip(lower=1.0, upper=89.0)


def sensitivity_analysis(df: pd.DataFrame, k: float, gravity: float = 9.80665, perturbation: float = 0.1) -> pd.DataFrame:
    """Estimate local sensitivity of mean Lmax to key inputs.

    The result expresses how the mean predicted Lmax changes when a variable
    is perturbed up/down by the provided fraction around the current sample.
    """

    if df.empty:
        return pd.DataFrame()
    base = terrock_lmax(k, df["carga_linear_kg_m"], df["tampao_real_m"], df["angulo_trajeto_graus"], gravity)
    base_mean = float(pd.to_numeric(base, errors="coerce").mean())
    if not np.isfinite(base_mean):
        return pd.DataFrame()
    rows = []
    variables = {
        "carga_linear_kg_m": "Carga linear",
        "tampao_real_m": "Tampão",
        "angulo_trajeto_graus": "Ângulo",
    }
    for column, label in variables.items():
        if column not in df or df[column].dropna().empty:
            continue
        plus = df.copy()
        minus = df.copy()
        if column == "angulo_trajeto_graus":
            step = max(1.0, float(df[column].abs().mean()) * perturbation)
            plus[column] = _clamp_angle(df[column].astype(float) + step)
            minus[column] = _clamp_angle(df[column].astype(float) - step)
        else:
            plus[column] = df[column].astype(float) * (1 + perturbation)
            minus[column] = df[column].astype(float) * (1 - perturbation)
        mean_plus = float(pd.to_numeric(terrock_lmax(k, plus["carga_linear_kg_m"], plus["tampao_real_m"], plus["angulo_trajeto_graus"], gravity), errors="coerce").mean())
        mean_minus = float(pd.to_numeric(terrock_lmax(k, minus["carga_linear_kg_m"], minus["tampao_real_m"], minus["angulo_trajeto_graus"], gravity), errors="coerce").mean())
        impact = abs(mean_plus - mean_minus) / 2
        rows.append(
            {
                "parametro": label,
                "coluna": column,
                "lmax_base_m": base_mean,
                "lmax_mais_m": mean_plus,
                "lmax_menos_m": mean_minus,
                "impacto_absoluto_m": impact,
                "impacto_percentual": impact / base_mean * 100 if base_mean else np.nan,
                "direcao": "aumenta" if mean_plus > mean_minus else "reduz",
            }
        )
    out = pd.DataFrame(rows)
    if not out.empty:
        out = out.sort_values("impacto_absoluto_m", ascending=False, ignore_index=True)
    return out
