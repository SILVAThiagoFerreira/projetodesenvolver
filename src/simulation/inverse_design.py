from __future__ import annotations

import numpy as np
import pandas as pd

from src.models.terrock import terrock_lmax


def _effective_value(row: pd.Series, preferred: str, fallback: str) -> float:
    value = row.get(preferred, row.get(fallback, np.nan))
    return float(pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0])


def _safe_current_lmax(row: pd.Series, k: float, gravity: float) -> float:
    carga = row.get("carga_linear_kg_m", np.nan)
    tampao = row.get("tampao_usado_m", row.get("tampao_real_m", np.nan))
    angulo = row.get("angulo_trajeto_graus", np.nan)
    value = pd.to_numeric(
        terrock_lmax(k, pd.Series([carga]), pd.Series([tampao]), pd.Series([angulo]), gravity),
        errors="coerce",
    ).iloc[0]
    return float(value)


def inverse_design_for_target(row: pd.Series, k: float, target_people_radius_m: float, people_factor: float = 4.0, gravity: float = 9.80665) -> dict[str, float | str | bool]:
    """Conservative inverse design for screening only.

    The function estimates the stemming and charge adjustments required to
    keep the people radius within the target. It does not generate an
    executable firing plan.
    """

    allowed = float(target_people_radius_m) / float(people_factor)
    current_lmax = _safe_current_lmax(row, k, gravity)
    current_tampao = _effective_value(row, "tampao_usado_m", "tampao_real_m")
    current_carga = _effective_value(row, "carga_usada_kg", "carga_realizada_kg")
    coluna_carregada = _effective_value(row, "coluna_carregada_m", "coluna_carregada_m")
    profundidade = _effective_value(row, "profundidade_m", "profundidade_m")

    if not np.isfinite(current_lmax) or current_lmax <= 0:
        return {
            "desmonte": row.get("desmonte", ""),
            "id_furo": row.get("id_furo", ""),
            "estado_atual": "indisponivel",
            "estado_necessario": f"Lmax <= {allowed:.2f} m",
            "lmax_previsto_atual_m": current_lmax,
            "raio_atual_pessoas_m": np.nan,
            "raio_alvo_pessoas_m": float(target_people_radius_m),
            "lmax_permitido_m": allowed,
            "tampao_atual_m": current_tampao,
            "tampao_necessario_m": np.nan,
            "aumento_tampao_necessario_m": np.nan,
            "carga_atual_kg": current_carga,
            "carga_necessaria_kg": np.nan,
            "reducao_percentual_carga_necessaria": np.nan,
            "diferenca_lmax_m": np.nan,
            "percentual_reducao_lmax": np.nan,
            "combinacao_otimizada": "triagem técnica inconclusiva: dados insuficientes ou inválidos",
            "alerta_viabilidade": "requer revisão técnica",
            "viavel": False,
            "triagem": True,
            "recomendacao_tecnica": "dados insuficientes para estimativa confiável",
        }

    if current_lmax <= allowed:
        return {
            "desmonte": row.get("desmonte", ""),
            "id_furo": row.get("id_furo", ""),
            "estado_atual": "conforme",
            "estado_necessario": "mantido dentro do alvo no cenário atual",
            "lmax_previsto_atual_m": current_lmax,
            "raio_atual_pessoas_m": current_lmax * people_factor,
            "raio_alvo_pessoas_m": float(target_people_radius_m),
            "lmax_permitido_m": allowed,
            "tampao_atual_m": current_tampao,
            "tampao_necessario_m": current_tampao,
            "aumento_tampao_necessario_m": 0.0,
            "carga_atual_kg": current_carga,
            "carga_necessaria_kg": current_carga,
            "reducao_percentual_carga_necessaria": 0.0,
            "diferenca_lmax_m": current_lmax - allowed,
            "percentual_reducao_lmax": 0.0,
            "combinacao_otimizada": "nenhuma alteração necessária para este alvo",
            "alerta_viabilidade": "conforme como triagem",
            "viavel": True,
            "triagem": True,
            "recomendacao_tecnica": "cenário atual atende ao alvo; manter apenas como triagem técnica",
        }

    ratio = allowed / current_lmax
    exponent = 1 / 1.3
    tampao_necessario = float(current_tampao / (ratio**exponent)) if ratio > 0 else np.nan
    carga_linear_necessaria = float(row.get("carga_linear_kg_m", np.nan) * (ratio**exponent)) if ratio > 0 else np.nan
    carga_necessaria = float(carga_linear_necessaria * coluna_carregada) if np.isfinite(carga_linear_necessaria) and np.isfinite(coluna_carregada) else np.nan
    reducao_carga_pct = max(0.0, (1 - carga_necessaria / current_carga) * 100) if np.isfinite(carga_necessaria) and current_carga > 0 else np.nan
    aumento_tampao_m = max(0.0, tampao_necessario - current_tampao) if np.isfinite(tampao_necessario) else np.nan
    viable = np.isfinite(tampao_necessario) and tampao_necessario < profundidade and np.isfinite(carga_necessaria) and carga_necessaria > 0
    return {
        "desmonte": row.get("desmonte", ""),
        "id_furo": row.get("id_furo", ""),
        "estado_atual": "acima_do_alvo",
        "estado_necessario": f"Lmax <= {allowed:.2f} m",
        "lmax_previsto_atual_m": current_lmax,
        "raio_atual_pessoas_m": current_lmax * people_factor,
        "raio_alvo_pessoas_m": float(target_people_radius_m),
        "lmax_permitido_m": allowed,
        "tampao_atual_m": float(current_tampao),
        "tampao_necessario_m": tampao_necessario,
        "aumento_tampao_necessario_m": aumento_tampao_m,
        "carga_atual_kg": float(current_carga),
        "carga_necessaria_kg": carga_necessaria,
        "reducao_percentual_carga_necessaria": reducao_carga_pct,
        "diferenca_lmax_m": current_lmax - allowed,
        "percentual_reducao_lmax": max(0.0, (1 - allowed / current_lmax) * 100),
        "combinacao_otimizada": "aumentar tampão e/ou reduzir carga linear mantendo afastamento e espaçamento sob revisão técnica",
        "alerta_viabilidade": "viavel como triagem" if viable else "requer redesenho tecnico; tampao necessario pode exceder profundidade ou carga inviavel",
        "viavel": viable,
        "triagem": True,
        "recomendacao_tecnica": "uso apenas para triagem; validar geometricamente antes de qualquer ajuste operacional",
    }


def inverse_design_table(df: pd.DataFrame, k: float, targets: list[float], people_factor: float, gravity: float = 9.80665) -> pd.DataFrame:
    valid = df[df.get("validation_status", pd.Series(dtype=str)).isin(["valid", "warning"])].copy()
    rows = []
    for target in targets:
        for _, row in valid.iterrows():
            rows.append(inverse_design_for_target(row, k, target, people_factor, gravity))
    return pd.DataFrame(rows)
