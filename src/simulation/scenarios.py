import pandas as pd


def calculate_safety_radius(lmax_reference: float, equipment_factor: float, people_factor: float, method: str = "referencia") -> dict[str, float | str]:
    return {
        "cenario": method,
        "lmax_referencia_m": float(lmax_reference),
        "fator_equipamentos": float(equipment_factor),
        "raio_equipamentos_m": float(lmax_reference * equipment_factor),
        "fator_pessoas": float(people_factor),
        "raio_pessoas_m": float(lmax_reference * people_factor),
        "metodo_calculo": method,
        "observacoes": "Resultado analitico para apoio a decisao; requer validacao tecnica.",
    }


def safety_table(df: pd.DataFrame, equipment_factor: float, people_factor: float) -> pd.DataFrame:
    refs = {
        "maximo_observado": df["distancia_horizontal_m"].max(),
        "maximo_previsto": df["lmax_previsto_m"].max(),
        "p90_previsto": df["lmax_previsto_m"].quantile(0.90),
        "p95_previsto": df["lmax_previsto_m"].quantile(0.95),
        "p99_previsto": df["lmax_previsto_m"].quantile(0.99),
    }
    return pd.DataFrame([calculate_safety_radius(v, equipment_factor, people_factor, k) for k, v in refs.items()])
