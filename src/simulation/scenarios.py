from __future__ import annotations

import pandas as pd


def calculate_safety_radius(lmax_reference: float, equipment_factor: float, people_factor: float, method: str = "referencia") -> dict[str, float | str | bool]:
    """Calculate screening radii for equipment and people."""

    lmax_reference = float(lmax_reference)
    equipment_factor = float(equipment_factor)
    people_factor = float(people_factor)
    return {
        "cenario": method,
        "lmax_referencia_m": lmax_reference,
        "fator_equipamentos": equipment_factor,
        "raio_equipamentos_m": float(lmax_reference * equipment_factor),
        "fator_pessoas": people_factor,
        "raio_pessoas_m": float(lmax_reference * people_factor),
        "metodo_calculo": method,
        "status": "screening",
        "e_conforme": bool(lmax_reference >= 0),
        "observacoes": "Resultado analitico para apoio a decisao; requer validacao tecnica.",
    }


def safety_table(df: pd.DataFrame, equipment_factor: float, people_factor: float) -> pd.DataFrame:
    if df.empty or "lmax_previsto_m" not in df.columns:
        return pd.DataFrame(columns=["cenario", "lmax_referencia_m", "fator_equipamentos", "raio_equipamentos_m", "fator_pessoas", "raio_pessoas_m", "metodo_calculo", "status", "e_conforme", "observacoes"])
    refs = {
        "maximo_observado": df.get("distancia_horizontal_m", pd.Series(dtype=float)).max(),
        "maximo_previsto": df["lmax_previsto_m"].max(),
        "p90_previsto": df["lmax_previsto_m"].quantile(0.90),
        "p95_previsto": df["lmax_previsto_m"].quantile(0.95),
        "p99_previsto": df["lmax_previsto_m"].quantile(0.99),
    }
    return pd.DataFrame([calculate_safety_radius(v, equipment_factor, people_factor, k) for k, v in refs.items()])
