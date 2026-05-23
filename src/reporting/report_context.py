from datetime import datetime
from pathlib import Path
import hashlib

import pandas as pd


def file_hash(path: str | Path) -> str:
    path = Path(path)
    if not path.exists():
        return ""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _scalar_rows(payload: dict | None, exclude: set[str] | None = None) -> list[dict[str, object]]:
    if not payload:
        return []
    excluded = exclude or set()
    rows = []
    for key, value in payload.items():
        if key in excluded:
            continue
        rows.append({"chave": key, "valor": value})
    return rows


def build_report_context(
    config: dict,
    match_report: dict,
    metrics: dict,
    safety: pd.DataFrame,
    inverse: pd.DataFrame,
    calibration_summary: dict | None = None,
    monte_carlo: dict | None = None,
    quality_summary: dict | None = None,
) -> dict:
    monte_carlo_summary = monte_carlo.get("summary") if monte_carlo else {}
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "model_version": "0.1.0",
        "config": config,
        "match_report": match_report,
        "metrics": metrics,
        "quality_summary": quality_summary or {},
        "quality_rows": _scalar_rows(quality_summary),
        "calibration_rows": _scalar_rows(calibration_summary, {"groups", "rankings"}),
        "calibration_groups": calibration_summary.get("groups", []) if calibration_summary else [],
        "calibration_rankings": calibration_summary.get("rankings", []) if calibration_summary else [],
        "monte_carlo_rows": _scalar_rows(monte_carlo_summary, {"percentiles", "prob_exceder_raio_pessoas", "prob_exceder_raio_equipamentos", "base_vs_simulado"}),
        "monte_carlo_percentiles": monte_carlo.get("summary_table", pd.DataFrame()).to_dict("records") if monte_carlo and "summary_table" in monte_carlo else [],
        "monte_carlo_people_risk": [{"raio_alvo_pessoas_m": key, "probabilidade": value} for key, value in (monte_carlo_summary.get("prob_exceder_raio_pessoas", {}) if monte_carlo_summary else {}).items()],
        "monte_carlo_equipment_risk": [{"raio_referencia_m": key, "probabilidade": value} for key, value in (monte_carlo_summary.get("prob_exceder_raio_equipamentos", {}) if monte_carlo_summary else {}).items()],
        "safety_rows": safety.to_dict("records"),
        "inverse_rows": inverse.head(30).to_dict("records"),
    }
