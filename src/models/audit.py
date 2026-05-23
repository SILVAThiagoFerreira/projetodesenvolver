from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Any

import pandas as pd


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return str(value)
    if pd.isna(value):
        return None
    return value


def _subset(row: pd.Series, fields: list[str]) -> dict[str, Any]:
    return {field: _json_safe(row.get(field)) for field in fields if field in row.index}


def build_calculation_trace(
    row: pd.Series,
    *,
    k_used: float | None,
    k_method: str,
    k_source: str,
    gravity: float,
    config_snapshot: dict[str, Any],
    formula: str = "Lmax = (K²/g) × (CL/DS)^1,3 × sen²(θ)",
    calculation_version: str = "1.0",
) -> dict[str, Any]:
    """Build a serializable audit record for a modeled row."""

    inputs = _subset(
        row,
        [
            "desmonte",
            "id_furo",
            "litologia",
            "densidade_litologica_g_cm3",
            "profundidade_m",
            "afastamento_m",
            "espacamento_m",
            "tampao_programado_m",
            "tampao_real_m",
            "tampao_usado_m",
            "carga_programada_kg",
            "carga_realizada_kg",
            "carga_usada_kg",
            "massa_desmontada_kt",
            "razao_carga",
            "distancia_horizontal_m",
            "velocidade_inicial_m_s",
            "altura_maxima_m",
            "angulo_trajeto_graus",
        ],
    )
    derived = _subset(
        row,
        [
            "coluna_carregada_m",
            "carga_linear_kg_m",
            "massa_estimativa_t",
            "razao_carga_calculada_kg_t",
            "razao_tampao_profundidade",
            "energia_relativa",
            "indice_confinamento",
            "k_evento",
            "k_aplicado",
            "lmax_previsto_m",
            "raio_pessoas_m",
            "raio_equipamentos_m",
            "erro_m",
            "erro_abs_m",
            "erro_percentual",
        ],
    )
    validation = {
        "status": _json_safe(row.get("validation_status")),
        "errors": _json_safe(row.get("validation_errors")),
        "warnings": _json_safe(row.get("validation_warnings")),
        "messages": _json_safe(row.get("validation_messages")),
        "outlier_reason": _json_safe(row.get("outlier_reason")),
        "outlier_included": _json_safe(row.get("outlier_included")),
    }
    trace = {
        "trace_id": None,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "calculation_version": calculation_version,
        "formula": formula,
        "gravity": gravity,
        "k_method": k_method,
        "k_source": k_source,
        "k_used": _json_safe(k_used),
        "inputs": inputs,
        "derived": derived,
        "validation": validation,
        "assumptions": {
            "units": config_snapshot.get("units", {}),
            "safety": config_snapshot.get("safety", {}),
            "model": {
                "group_by_lithology": config_snapshot.get("model", {}).get("group_by_lithology"),
                "use_real_stemming": config_snapshot.get("model", {}).get("use_real_stemming"),
                "use_real_charge": config_snapshot.get("model", {}).get("use_real_charge"),
            },
        },
        "config_version": config_snapshot.get("project", {}).get("name"),
    }
    trace_blob = json.dumps(trace, ensure_ascii=False, sort_keys=True, default=_json_safe)
    trace["trace_id"] = sha256(trace_blob.encode("utf-8")).hexdigest()
    return trace


def trace_to_json(trace: dict[str, Any]) -> str:
    return json.dumps(trace, ensure_ascii=False, sort_keys=True, default=_json_safe)
