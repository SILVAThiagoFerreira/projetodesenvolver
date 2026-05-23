from __future__ import annotations

import numpy as np
import pandas as pd

from src.features.units import to_numeric


TEXT_LEVELS = {
    "desmonte": "critical",
    "id_furo": "critical",
    "litologia": "warning",
}

NUMERIC_LEVELS = {
    "profundidade_m": "invalid",
    "carga_realizada_kg": "invalid",
    "distancia_horizontal_m": "invalid",
    "afastamento_m": "invalid",
    "espacamento_m": "invalid",
}

TEXT_REQUIRED = ["litologia", "desmonte", "id_furo"]


def _append_issue(issues: list[dict[str, list[str]]], idx: int, severity: str, message: str) -> None:
    issues[idx][severity].append(message)


def _detect_status(entry: dict[str, list[str]]) -> str:
    if entry["critical"]:
        return "critical"
    if entry["invalid"]:
        return "invalid"
    if entry["warning"]:
        return "warning"
    return "valid"


def _select_effective_column(out: pd.DataFrame, preferred: str, fallback: str | None = None) -> str | None:
    if preferred in out.columns:
        return preferred
    if fallback and fallback in out.columns:
        return fallback
    return None


def validate_modeling_data(
    df: pd.DataFrame,
    default_angle_when_missing: float | None = None,
    use_real_stemming: bool = True,
    use_real_charge: bool = True,
) -> pd.DataFrame:
    """Validate the merged modeling base and classify each row by severity.

    Status values:
    - valid: safe to calculate.
    - warning: calculable, but requires attention.
    - invalid: excluded from calibration/calculation.
    - critical: blocked until reviewed.
    """

    out = df.copy()
    row_count = len(out)
    issues: list[dict[str, list[str]]] = [{"critical": [], "invalid": [], "warning": []} for _ in range(row_count)]

    for col in TEXT_REQUIRED:
        severity = TEXT_LEVELS.get(col, "warning")
        if col not in out.columns:
            for i in range(row_count):
                _append_issue(issues, i, severity, f"{col} ausente")
            continue
        ok = out[col].notna() & out[col].astype(str).str.strip().ne("")
        for i, valid in enumerate(ok.to_numpy()):
            if not valid:
                _append_issue(issues, i, severity, f"{col} vazio")

    stemming_source = "tampao_real_m"
    if not use_real_stemming and "tampao_programado_m" in out.columns:
        stemming_source = "tampao_programado_m"
    elif "tampao_real_m" not in out.columns and "tampao_programado_m" in out.columns:
        stemming_source = "tampao_programado_m"

    charge_source = "carga_realizada_kg"
    if not use_real_charge and "carga_programada_kg" in out.columns:
        charge_source = "carga_programada_kg"
    elif "carga_realizada_kg" not in out.columns and "carga_programada_kg" in out.columns:
        charge_source = "carga_programada_kg"

    out["effective_stemming_source"] = stemming_source
    out["effective_charge_source"] = charge_source

    angle_col = "angulo_trajeto_graus"
    if angle_col not in out.columns:
        if default_angle_when_missing is not None:
            out[angle_col] = default_angle_when_missing
            for i in range(row_count):
                _append_issue(issues, i, "warning", "angulo_trajeto_graus preenchido com default_angle_when_missing")
        else:
            for i in range(row_count):
                _append_issue(issues, i, "invalid", "angulo_trajeto_graus ausente")
    elif default_angle_when_missing is not None:
        missing = out[angle_col].isna()
        if missing.any():
            out.loc[missing, angle_col] = default_angle_when_missing
            for idx in np.flatnonzero(missing.to_numpy()).tolist():
                _append_issue(issues, int(idx), "warning", "angulo_trajeto_graus preenchido com default_angle_when_missing")

    numeric_checks = {
        "profundidade_m": lambda s: s > 0,
        charge_source: lambda s: s > 0,
        stemming_source: lambda s: s > 0,
        "distancia_horizontal_m": lambda s: s > 0,
        angle_col: lambda s: (s > 0) & (s < 90),
        "afastamento_m": lambda s: s > 0,
        "espacamento_m": lambda s: s > 0,
    }

    for col, rule in numeric_checks.items():
        if col not in out.columns:
            severity = "invalid"
            if col == "distancia_horizontal_m":
                severity = "invalid"
            for i in range(row_count):
                _append_issue(issues, i, severity, f"{col} ausente")
            continue
        values = to_numeric(out[col])
        if col == "angulo_trajeto_graus":
            valid = rule(values)
        else:
            valid = rule(values)
        for i, ok in enumerate(valid.fillna(False).to_numpy()):
            if not ok:
                severity = "invalid"
                if col == stemming_source:
                    severity = "invalid"
                _append_issue(issues, i, severity, f"{col} invalido")

    if stemming_source in out.columns and "profundidade_m" in out.columns:
        stem = to_numeric(out[stemming_source])
        depth = to_numeric(out["profundidade_m"])
        for i, valid in enumerate((stem < depth).fillna(False).to_numpy()):
            if not valid:
                _append_issue(issues, i, "critical", f"{stemming_source} deve ser menor que profundidade_m")

    if "densidade_litologica_g_cm3" in out.columns:
        density = to_numeric(out["densidade_litologica_g_cm3"])
        missing = density.isna()
        for i, is_missing in enumerate(missing.to_numpy()):
            if is_missing:
                _append_issue(issues, i, "warning", "densidade_litologica_g_cm3 ausente")
        for i, ok in enumerate((density > 0).fillna(False).to_numpy()):
            if not ok and not missing.iloc[i]:
                _append_issue(issues, i, "invalid", "densidade_litologica_g_cm3 invalida")
    else:
        for i in range(row_count):
            _append_issue(issues, i, "warning", "densidade_litologica_g_cm3 ausente")

    statuses = [_detect_status(entry) for entry in issues]
    out["validation_errors"] = ["; ".join(entry["critical"] + entry["invalid"]) for entry in issues]
    out["validation_warnings"] = ["; ".join(entry["warning"]) for entry in issues]
    out["validation_messages"] = ["; ".join(entry["critical"] + entry["invalid"] + entry["warning"]) for entry in issues]
    out["validation_status"] = statuses
    out["validation_blocked"] = out["validation_status"].isin(["invalid", "critical"])
    out["validation_calculable"] = out["validation_status"].isin(["valid", "warning"])
    return out


def _iqr_mask(series: pd.Series, multiplier: float) -> pd.Series:
    q1, q3 = series.quantile(0.25), series.quantile(0.75)
    iqr = q3 - q1
    if not np.isfinite(iqr) or iqr == 0:
        return pd.Series(False, index=series.index)
    return (series < q1 - multiplier * iqr) | (series > q3 + multiplier * iqr)


def _zscore_mask(series: pd.Series, threshold: float) -> pd.Series:
    std = series.std()
    if not std or np.isnan(std):
        return pd.Series(False, index=series.index)
    return (series - series.mean()).abs().div(std) > threshold


def _percentile_mask(series: pd.Series, low: float, high: float) -> pd.Series:
    lower = series.quantile(low)
    upper = series.quantile(high)
    return (series < lower) | (series > upper)


def _physical_mask(series: pd.Series, column: str) -> pd.Series:
    lower_bounds = {
        "profundidade_m": 0,
        "tampao_real_m": 0,
        "tampao_usado_m": 0,
        "carga_realizada_kg": 0,
        "carga_usada_kg": 0,
        "distancia_horizontal_m": 0,
        "afastamento_m": 0,
        "espacamento_m": 0,
    }
    upper_bounds = {
        "angulo_trajeto_graus": 90,
    }
    mask = pd.Series(False, index=series.index)
    if column in lower_bounds:
        mask |= series <= lower_bounds[column]
    if column in upper_bounds:
        mask |= series >= upper_bounds[column]
    return mask


def flag_outliers(
    df: pd.DataFrame,
    columns: list[str],
    method: str = "iqr",
    iqr_multiplier: float = 1.5,
    zscore_threshold: float = 3.0,
    percentile_low: float = 0.05,
    percentile_high: float = 0.95,
) -> pd.DataFrame:
    """Flag statistical and physical outliers without removing rows.

    The method can be `iqr`, `zscore`, `percentile`, `physical`, `operational`, or `hybrid`.
    """

    out = df.copy()
    reasons: list[list[str]] = [[] for _ in range(len(out))]
    for col in columns:
        if col not in out.columns:
            continue
        s = to_numeric(out[col])
        if s.dropna().empty:
            continue
        if method == "zscore":
            mask = _zscore_mask(s, zscore_threshold)
        elif method == "percentile":
            mask = _percentile_mask(s, percentile_low, percentile_high)
        elif method in {"physical", "operational"}:
            mask = _physical_mask(s, col)
        elif method == "hybrid":
            mask = _iqr_mask(s, iqr_multiplier) | _zscore_mask(s, zscore_threshold) | _physical_mask(s, col)
        else:
            mask = _iqr_mask(s, iqr_multiplier)
        for i, is_outlier in enumerate(mask.fillna(False).to_numpy()):
            if is_outlier:
                reasons[i].append(f"{col} outlier ({method})")
    out["outlier_reason"] = ["; ".join(r) for r in reasons]
    out["is_outlier"] = out["outlier_reason"].ne("")
    out["outlier_method"] = method
    return out
