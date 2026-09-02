from __future__ import annotations

import numpy as np
import pandas as pd

from src.models.terrock import terrock_lmax


def _effective_value(row: pd.Series, preferred: str, fallback: str) -> float:
    value = row.get(preferred, np.nan)
    if pd.isna(value):
        value = row.get(fallback, np.nan)
    return float(pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0])


def _safe_current_lmax(row: pd.Series, k: float, gravity: float) -> float:
    observed = _effective_value(row, "distancia_horizontal_m", "distancia_horizontal_m")
    if np.isfinite(observed) and observed > 0:
        return observed
    carga = row.get("carga_linear_kg_m", np.nan)
    tampao = row.get("tampao_usado_m", row.get("tampao_real_m", np.nan))
    angulo = row.get("angulo_trajeto_graus", np.nan)
    value = pd.to_numeric(
        terrock_lmax(k, pd.Series([carga]), pd.Series([tampao]), pd.Series([angulo]), gravity),
        errors="coerce",
    ).iloc[0]
    return float(value)


def inverse_design_for_target(
    row: pd.Series,
    k: float,
    target_people_radius_m: float,
    people_factor: float = 4.0,
    gravity: float = 9.80665,
    target_equipment_radius_m: float | None = None,
    equipment_factor: float = 2.0,
) -> dict[str, float | str | bool]:
    """Conservative inverse design for screening only.

    The function estimates the stemming and charge adjustments required to
    keep the people radius within the target. It does not generate an
    executable firing plan.
    """

    allowed_people = float(target_people_radius_m) / float(people_factor)
    allowed_equipment = (
        float(target_equipment_radius_m) / float(equipment_factor)
        if target_equipment_radius_m is not None
        else float("inf")
    )
    allowed = min(allowed_people, allowed_equipment)
    limiting = "pessoas" if allowed_people <= allowed_equipment else "equipamentos"
    current_lmax = _safe_current_lmax(row, k, gravity)
    current_tampao = _effective_value(row, "tampao_usado_m", "tampao_real_m")
    current_carga = _effective_value(row, "carga_usada_kg", "carga_realizada_kg")
    profundidade = _effective_value(row, "profundidade_m", "profundidade_m")
    coluna_carregada = _effective_value(row, "coluna_carregada_m", "coluna_carregada_m")
    if not np.isfinite(coluna_carregada) and np.isfinite(profundidade) and np.isfinite(current_tampao):
        coluna_carregada = profundidade - current_tampao
    carga_linear = _effective_value(row, "carga_linear_kg_m", "carga_linear_kg_m")
    massa_t = _effective_value(row, "massa_estimativa_t", "massa_estimativa_t")
    razao_atual = _effective_value(row, "razao_carga_calculada_kg_t", "razao_carga_calculada_kg_t")
    if not np.isfinite(razao_atual) and np.isfinite(massa_t) and massa_t > 0:
        razao_atual = current_carga / massa_t
    observed_lmax = _effective_value(row, "distancia_horizontal_m", "distancia_horizontal_m")
    fonte_lmax = "observado na base" if np.isfinite(observed_lmax) and observed_lmax > 0 else "Terrock previsto"
    target_equipment = float(target_equipment_radius_m) if target_equipment_radius_m is not None else np.nan

    if not np.isfinite(current_lmax) or current_lmax <= 0:
        return {
            "desmonte": row.get("desmonte", ""),
            "id_furo": row.get("id_furo", ""),
            "estado_atual": "indisponivel",
            "estado_necessario": f"Lmax <= {allowed:.2f} m",
            "lmax_previsto_atual_m": current_lmax,
            "fonte_lmax": fonte_lmax,
            "raio_atual_pessoas_m": np.nan,
            "raio_atual_equipamentos_m": np.nan,
            "raio_alvo_pessoas_m": float(target_people_radius_m),
            "raio_alvo_equipamentos_m": target_equipment,
            "lmax_permitido_m": allowed,
            "limite_controlador": limiting,
            "estado_adequacao": "indisponivel",
            "tampao_atual_m": current_tampao,
            "tampao_necessario_m": np.nan,
            "aumento_tampao_necessario_m": np.nan,
            "carga_atual_kg": current_carga,
            "carga_necessaria_kg": np.nan,
            "cme_com_tampao_kg": np.nan,
            "reducao_percentual_carga_necessaria": np.nan,
            "razao_carga_atual_kg_t": razao_atual,
            "razao_carga_com_cme_kg_t": np.nan,
            "razao_carga_com_tampao_kg_t": np.nan,
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
            "fonte_lmax": fonte_lmax,
            "raio_atual_pessoas_m": current_lmax * people_factor,
            "raio_atual_equipamentos_m": current_lmax * equipment_factor,
            "raio_alvo_pessoas_m": float(target_people_radius_m),
            "raio_alvo_equipamentos_m": target_equipment,
            "lmax_permitido_m": allowed,
            "limite_controlador": limiting,
            "estado_adequacao": "manter",
            "tampao_atual_m": current_tampao,
            "tampao_necessario_m": current_tampao,
            "aumento_tampao_necessario_m": 0.0,
            "carga_atual_kg": current_carga,
            "carga_necessaria_kg": current_carga,
            "cme_com_tampao_kg": current_carga,
            "reducao_percentual_carga_necessaria": 0.0,
            "razao_carga_atual_kg_t": razao_atual,
            "razao_carga_com_cme_kg_t": razao_atual,
            "razao_carga_com_tampao_kg_t": razao_atual,
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
    reduction_factor = float(ratio**exponent) if ratio > 0 else np.nan
    tampao_necessario = float(current_tampao / reduction_factor) if np.isfinite(reduction_factor) else np.nan
    carga_necessaria = float(current_carga * reduction_factor) if np.isfinite(reduction_factor) else np.nan
    coluna_com_tampao = max(0.0, profundidade - tampao_necessario) if np.isfinite(profundidade) and np.isfinite(tampao_necessario) else np.nan
    carga_com_tampao = float(carga_linear * coluna_com_tampao) if np.isfinite(carga_linear) and np.isfinite(coluna_com_tampao) else np.nan
    reducao_carga_pct = max(0.0, (1 - carga_necessaria / current_carga) * 100) if np.isfinite(carga_necessaria) and current_carga > 0 else np.nan
    aumento_tampao_m = max(0.0, tampao_necessario - current_tampao) if np.isfinite(tampao_necessario) else np.nan
    viable = np.isfinite(tampao_necessario) and tampao_necessario < profundidade and np.isfinite(carga_necessaria) and carga_necessaria > 0
    return {
        "desmonte": row.get("desmonte", ""),
        "id_furo": row.get("id_furo", ""),
        "estado_atual": "acima_do_alvo",
        "estado_necessario": f"Lmax <= {allowed:.2f} m",
        "lmax_previsto_atual_m": current_lmax,
        "fonte_lmax": fonte_lmax,
        "raio_atual_pessoas_m": current_lmax * people_factor,
        "raio_atual_equipamentos_m": current_lmax * equipment_factor,
        "raio_alvo_pessoas_m": float(target_people_radius_m),
        "raio_alvo_equipamentos_m": target_equipment,
        "lmax_permitido_m": allowed,
        "limite_controlador": limiting,
        "estado_adequacao": "ajustar",
        "tampao_atual_m": float(current_tampao),
        "tampao_necessario_m": tampao_necessario,
        "aumento_tampao_necessario_m": aumento_tampao_m,
        "carga_atual_kg": float(current_carga),
        "carga_necessaria_kg": carga_necessaria,
        "cme_com_tampao_kg": carga_com_tampao,
        "reducao_percentual_carga_necessaria": reducao_carga_pct,
        "razao_carga_atual_kg_t": razao_atual,
        "razao_carga_com_cme_kg_t": carga_necessaria / massa_t if np.isfinite(carga_necessaria) and np.isfinite(massa_t) and massa_t > 0 else np.nan,
        "razao_carga_com_tampao_kg_t": carga_com_tampao / massa_t if np.isfinite(carga_com_tampao) and np.isfinite(massa_t) and massa_t > 0 else np.nan,
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
