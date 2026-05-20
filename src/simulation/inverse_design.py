import numpy as np
import pandas as pd

from src.models.terrock import terrock_lmax


def inverse_design_for_target(row: pd.Series, k: float, target_people_radius_m: float, people_factor: float = 4.0, gravity: float = 9.80665) -> dict[str, float | str]:
    allowed = target_people_radius_m / people_factor
    current_lmax = float(terrock_lmax(k, pd.Series([row["carga_linear_kg_m"]]), pd.Series([row["tampao_real_m"]]), pd.Series([row["angulo_trajeto_graus"]]), gravity).iloc[0])
    ratio = allowed / current_lmax if current_lmax > 0 else np.nan
    tampao_necessario = float(row["tampao_real_m"] / (ratio ** (1 / 1.3))) if ratio > 0 else np.nan
    carga_linear_necessaria = float(row["carga_linear_kg_m"] * (ratio ** (1 / 1.3))) if ratio > 0 else np.nan
    carga_necessaria = carga_linear_necessaria * row["coluna_carregada_m"]
    reducao_carga_pct = max(0.0, (1 - carga_necessaria / row["carga_realizada_kg"]) * 100)
    aumento_tampao_m = max(0.0, tampao_necessario - row["tampao_real_m"])
    viable = tampao_necessario < row["profundidade_m"] and carga_necessaria > 0
    return {
        "desmonte": row.get("desmonte", ""),
        "id_furo": row.get("id_furo", ""),
        "lmax_previsto_atual_m": current_lmax,
        "raio_atual_pessoas_m": current_lmax * people_factor,
        "raio_alvo_pessoas_m": target_people_radius_m,
        "lmax_permitido_m": allowed,
        "tampao_atual_m": float(row["tampao_real_m"]),
        "tampao_necessario_m": tampao_necessario,
        "aumento_tampao_necessario_m": aumento_tampao_m,
        "carga_atual_kg": float(row["carga_realizada_kg"]),
        "carga_necessaria_kg": float(carga_necessaria),
        "reducao_percentual_carga_necessaria": reducao_carga_pct,
        "combinacao_otimizada": "aumentar tampao e/ou reduzir carga linear mantendo afastamento e espacamento sob revisao tecnica",
        "alerta_viabilidade": "viavel como triagem" if viable else "requer redesenho tecnico; tampao necessario pode exceder profundidade ou carga inviavel",
    }


def inverse_design_table(df: pd.DataFrame, k: float, targets: list[float], people_factor: float, gravity: float = 9.80665) -> pd.DataFrame:
    valid = df[df["validation_status"].eq("valid")].copy()
    rows = []
    for target in targets:
        for _, row in valid.iterrows():
            rows.append(inverse_design_for_target(row, k, target, people_factor, gravity))
    return pd.DataFrame(rows)
