import numpy as np
import pandas as pd

from src.models.terrock import terrock_lmax


def monte_carlo_lmax(df: pd.DataFrame, k: float, n: int = 10000, seed: int = 42, gravity: float = 9.80665) -> pd.Series:
    rng = np.random.default_rng(seed)
    sample = df.dropna(subset=["carga_linear_kg_m", "tampao_real_m", "angulo_trajeto_graus"])
    idx = rng.integers(0, len(sample), size=n)
    drawn = sample.iloc[idx]
    return terrock_lmax(k, drawn["carga_linear_kg_m"].reset_index(drop=True), drawn["tampao_real_m"].reset_index(drop=True), drawn["angulo_trajeto_graus"].reset_index(drop=True), gravity)
