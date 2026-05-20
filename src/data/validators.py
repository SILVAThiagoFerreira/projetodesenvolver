import numpy as np
import pandas as pd


REQUIRED_RULES = {
    "profundidade_m": lambda s: s > 0,
    "tampao_real_m": lambda s: s > 0,
    "carga_realizada_kg": lambda s: s > 0,
    "distancia_horizontal_m": lambda s: s > 0,
    "angulo_trajeto_graus": lambda s: (s > 0) & (s < 90),
    "afastamento_m": lambda s: s > 0,
    "espacamento_m": lambda s: s > 0,
}
TEXT_REQUIRED = ["litologia", "desmonte", "id_furo"]


def validate_modeling_data(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    errors: list[list[str]] = [[] for _ in range(len(out))]
    for col, rule in REQUIRED_RULES.items():
        if col not in out:
            for row in errors:
                row.append(f"{col} ausente")
            continue
        valid = rule(out[col].astype(float))
        for i, ok in enumerate(valid.fillna(False).to_numpy()):
            if not ok:
                errors[i].append(f"{col} invalido")
    if {"tampao_real_m", "profundidade_m"}.issubset(out.columns):
        ok = out["tampao_real_m"] < out["profundidade_m"]
        for i, valid in enumerate(ok.fillna(False).to_numpy()):
            if not valid:
                errors[i].append("tampao_real_m deve ser menor que profundidade_m")
    for col in TEXT_REQUIRED:
        if col not in out:
            for row in errors:
                row.append(f"{col} ausente")
        else:
            ok = out[col].astype(str).str.strip().ne("") & out[col].notna()
            for i, valid in enumerate(ok.to_numpy()):
                if not valid:
                    errors[i].append(f"{col} vazio")
    out["validation_errors"] = ["; ".join(e) for e in errors]
    out["validation_status"] = np.where(out["validation_errors"].eq(""), "valid", "invalid")
    return out


def flag_outliers(df: pd.DataFrame, columns: list[str], method: str = "iqr", iqr_multiplier: float = 1.5, zscore_threshold: float = 3.0) -> pd.DataFrame:
    out = df.copy()
    reasons = [[] for _ in range(len(out))]
    for col in columns:
        if col not in out:
            continue
        s = pd.to_numeric(out[col], errors="coerce")
        if method == "zscore":
            std = s.std()
            mask = (abs((s - s.mean()) / std) > zscore_threshold) if std and not np.isnan(std) else pd.Series(False, index=s.index)
        else:
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            mask = (s < q1 - iqr_multiplier * iqr) | (s > q3 + iqr_multiplier * iqr)
        for i, is_outlier in enumerate(mask.fillna(False).to_numpy()):
            if is_outlier:
                reasons[i].append(f"{col} outlier")
    out["outlier_reason"] = ["; ".join(r) for r in reasons]
    out["is_outlier"] = out["outlier_reason"].ne("")
    return out
