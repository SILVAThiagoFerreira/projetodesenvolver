from __future__ import annotations

import numpy as np
import pandas as pd

from src.features.units import safe_divide, to_numeric
from src.utils.exceptions import CalculationError, DataValidationError


def _as_broadcast_arrays(*values):
    arrays = []
    index = None
    any_series = False
    for value in values:
        if isinstance(value, pd.Series):
            any_series = True
            if index is None:
                index = value.index
            arrays.append(pd.to_numeric(value, errors="coerce").to_numpy(dtype=float))
        elif np.isscalar(value):
            arrays.append(np.asarray([value], dtype=float))
        else:
            arrays.append(pd.to_numeric(pd.Series(value), errors="coerce").to_numpy(dtype=float))
            any_series = True
            if index is None:
                index = pd.RangeIndex(len(arrays[-1]))
    try:
        broadcasted = np.broadcast_arrays(*arrays)
    except ValueError as exc:
        raise CalculationError(f"Entradas incompatíveis para cálculo de Terrock: {exc}") from exc
    return broadcasted, index, any_series or any(arr.size > 1 for arr in broadcasted)


def _as_float(value, field_name: str) -> float:
    numeric = to_numeric(pd.Series([value])).iloc[0] if not isinstance(value, (int, float, np.number)) else float(value)
    if not np.isfinite(numeric):
        raise DataValidationError(f"{field_name} deve ser numérico")
    return float(numeric)


def calculate_lmax_scalar(k: float, carga_linear_kg_m: float, tampao_m: float, angulo_graus: float, gravity: float = 9.80665) -> float:
    """Calculate Terrock Lmax for scalar inputs.

    Inputs:
    - k: empirical Terrock constant, dimensionless in this model convention.
    - carga_linear_kg_m: charge linear in kg/m.
    - tampao_m: stemming length in meters.
    - angulo_graus: trajectory angle in degrees.
    - gravity: gravitational acceleration in m/s².

    Output:
    - Lmax in meters.
    """

    k = _as_float(k, "K")
    carga_linear_kg_m = _as_float(carga_linear_kg_m, "carga linear")
    tampao_m = _as_float(tampao_m, "tampão")
    angulo_graus = _as_float(angulo_graus, "ângulo")
    gravity = _as_float(gravity, "gravidade")
    if k <= 0:
        raise DataValidationError("K deve ser positivo")
    if carga_linear_kg_m <= 0:
        raise DataValidationError("carga_linear_kg_m deve ser positiva")
    if tampao_m <= 0:
        raise DataValidationError("tampao_m deve ser positivo")
    if not 0 < angulo_graus < 90:
        raise DataValidationError("angulo_graus deve estar entre 0 e 90")
    if gravity <= 0:
        raise DataValidationError("gravity deve ser positivo")
    theta = np.deg2rad(angulo_graus)
    return float(((k**2) / gravity) * ((carga_linear_kg_m / tampao_m) ** 1.3) * (np.sin(theta) ** 2))


def calculate_k_event_scalar(lmax_observado_m: float, carga_linear_kg_m: float, tampao_m: float, angulo_graus: float, gravity: float = 9.80665) -> float:
    """Back-calculate Terrock K for a scalar observed event.

    Inputs use the same units as `calculate_lmax_scalar`.
    Output is the calibrated K constant.
    """

    lmax_observado_m = _as_float(lmax_observado_m, "Lmax observado")
    carga_linear_kg_m = _as_float(carga_linear_kg_m, "carga linear")
    tampao_m = _as_float(tampao_m, "tampão")
    angulo_graus = _as_float(angulo_graus, "ângulo")
    gravity = _as_float(gravity, "gravidade")
    if lmax_observado_m <= 0:
        raise DataValidationError("Lmax observado deve ser positivo")
    lmax = calculate_lmax_scalar(1.0, carga_linear_kg_m, tampao_m, angulo_graus, gravity)
    if lmax <= 0:
        raise CalculationError("Denominador inválido ao recalcular K")
    return float(np.sqrt(lmax_observado_m / lmax))


def terrock_lmax(k: float | pd.Series, carga_linear_kg_m, tampao_m, angulo_graus, gravity: float = 9.80665):
    """Vectorized Terrock Lmax calculation.

    Returns a float for scalar inputs and a pandas Series for vector inputs.
    Invalid values become NaN in vectorized mode.
    """

    if all(not isinstance(value, pd.Series) for value in [k, carga_linear_kg_m, tampao_m, angulo_graus]):
        return calculate_lmax_scalar(k, carga_linear_kg_m, tampao_m, angulo_graus, gravity)
    arrays, index, vectorized = _as_broadcast_arrays(k, carga_linear_kg_m, tampao_m, angulo_graus, gravity)
    k_arr, cl_arr, stem_arr, ang_arr, g_arr = arrays
    valid = np.isfinite(k_arr) & np.isfinite(cl_arr) & np.isfinite(stem_arr) & np.isfinite(ang_arr) & np.isfinite(g_arr)
    valid &= (k_arr > 0) & (cl_arr > 0) & (stem_arr > 0) & (g_arr > 0) & (ang_arr > 0) & (ang_arr < 90)
    theta = np.deg2rad(ang_arr)
    result = np.full_like(cl_arr, np.nan, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        result[valid] = ((k_arr[valid] ** 2) / g_arr[valid]) * ((cl_arr[valid] / stem_arr[valid]) ** 1.3) * (np.sin(theta[valid]) ** 2)
    if vectorized:
        return pd.Series(result, index=index if index is not None else range(len(result)))
    return float(result[0])


def calculate_k_event(lmax_observado_m, carga_linear_kg_m, tampao_m, angulo_graus, gravity: float = 9.80665):
    """Vectorized back-calculation of Terrock K.

    Returns a float for scalar inputs and a pandas Series for vector inputs.
    Invalid values become NaN in vectorized mode.
    """

    if all(not isinstance(value, pd.Series) for value in [lmax_observado_m, carga_linear_kg_m, tampao_m, angulo_graus]):
        return calculate_k_event_scalar(lmax_observado_m, carga_linear_kg_m, tampao_m, angulo_graus, gravity)
    arrays, index, vectorized = _as_broadcast_arrays(lmax_observado_m, carga_linear_kg_m, tampao_m, angulo_graus, gravity)
    lmax_arr, cl_arr, stem_arr, ang_arr, g_arr = arrays
    valid = np.isfinite(lmax_arr) & np.isfinite(cl_arr) & np.isfinite(stem_arr) & np.isfinite(ang_arr) & np.isfinite(g_arr)
    valid &= (lmax_arr > 0) & (cl_arr > 0) & (stem_arr > 0) & (g_arr > 0) & (ang_arr > 0) & (ang_arr < 90)
    theta = np.deg2rad(ang_arr)
    denominator = ((cl_arr / stem_arr) ** 1.3) * (np.sin(theta) ** 2)
    result = np.full_like(lmax_arr, np.nan, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        result[valid] = np.sqrt((lmax_arr[valid] * g_arr[valid]) / denominator[valid])
    if vectorized:
        return pd.Series(result, index=index if index is not None else range(len(result)))
    return float(result[0])


def add_terrock_results(df: pd.DataFrame, k: float | pd.Series, gravity: float = 9.80665) -> pd.DataFrame:
    """Add Terrock-derived columns to a model DataFrame."""

    out = df.copy()
    tampao_col = "tampao_usado_m" if "tampao_usado_m" in out.columns else "tampao_real_m"
    if isinstance(k, pd.Series):
        k_series = pd.Series(pd.to_numeric(k, errors="coerce").to_numpy(), index=out.index)
    else:
        k_series = pd.Series([float(k)] * len(out), index=out.index, dtype=float)
    out["k_aplicado"] = k_series
    out["k_evento"] = calculate_k_event(out["distancia_horizontal_m"], out["carga_linear_kg_m"], out[tampao_col], out["angulo_trajeto_graus"], gravity)
    out["lmax_previsto_m"] = terrock_lmax(out["k_aplicado"], out["carga_linear_kg_m"], out[tampao_col], out["angulo_trajeto_graus"], gravity)
    out["erro_m"] = out["lmax_previsto_m"] - out["distancia_horizontal_m"]
    out["erro_abs_m"] = out["erro_m"].abs()
    out["erro_percentual"] = safe_divide(out["erro_m"], out["distancia_horizontal_m"]) * 100
    out.replace([np.inf, -np.inf], np.nan, inplace=True)
    return out
