from __future__ import annotations

from collections import Counter
from typing import cast

import numpy as np
import pandas as pd

from src.models.terrock import terrock_lmax


def _range_bounds(range_like, default_min: float, default_max: float) -> tuple[float, float]:
    if range_like is None:
        return default_min, default_max
    return float(getattr(range_like, "min", default_min)), float(getattr(range_like, "max", default_max))


def simulate_monte_carlo(
    df: pd.DataFrame,
    k: float,
    n: int = 10000,
    seed: int = 42,
    gravity: float = 9.80665,
    stemming_range_m=None,
    charge_reduction_percent=None,
    angle_range_degrees=None,
    target_people_radius_m: list[float] | float | None = None,
    people_factor: float = 4.0,
    equipment_factor: float = 2.0,
    summary_percentiles: list[int] | None = None,
) -> dict[str, object]:
    """Run a conservative Monte Carlo simulation for Terrock Lmax.

    The simulation bootstraps valid rows and perturbs stemming, charge reduction,
    and angle inside the configured ranges. Invalid draws are counted and reported.
    """

    stemming_col = "tampao_usado_m" if "tampao_usado_m" in df.columns else "tampao_real_m"
    charge_col = "carga_usada_kg" if "carga_usada_kg" in df.columns else "carga_realizada_kg"
    required_cols = ["carga_linear_kg_m", stemming_col, charge_col, "angulo_trajeto_graus", "distancia_horizontal_m", "profundidade_m"]
    missing_required = [c for c in required_cols if c not in df.columns]
    if missing_required:
        return {
            "samples": pd.DataFrame(),
            "summary": pd.DataFrame(),
            "discarded": {"missing_required_columns": missing_required},
            "seed": seed,
            "n_requested": n,
            "n_valid": 0,
            "n_discarded": int(n),
        }
    sample = df.dropna(subset=required_cols).copy()
    sample = sample[sample["validation_status"].isin(["valid", "warning"])] if "validation_status" in sample.columns else sample
    if sample.empty or n <= 0:
        return {
            "samples": pd.DataFrame(),
            "summary": pd.DataFrame(),
            "discarded": {"no_valid_base_rows": int(sample.empty), "invalid_draw": 0},
            "seed": seed,
            "n_requested": n,
            "n_valid": 0,
            "n_discarded": int(n),
        }

    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(sample), size=n)
    drawn = sample.iloc[idx].reset_index(drop=True).copy()
    stem_min, stem_max = _range_bounds(stemming_range_m, float(drawn[stemming_col].min()), float(drawn[stemming_col].max()))
    red_min, red_max = _range_bounds(charge_reduction_percent, 0.0, 40.0)
    angle_min, angle_max = _range_bounds(angle_range_degrees, float(drawn["angulo_trajeto_graus"].min()), float(drawn["angulo_trajeto_graus"].max()))
    red_pct = rng.uniform(red_min, red_max, size=n)
    stem_sim = rng.uniform(stem_min, stem_max, size=n)
    angle_sim = rng.uniform(angle_min, angle_max, size=n)
    base_charge = pd.to_numeric(drawn[charge_col], errors="coerce").to_numpy(dtype=float)
    base_distance = pd.to_numeric(drawn["distancia_horizontal_m"], errors="coerce").to_numpy(dtype=float)
    base_tampao = pd.to_numeric(drawn[stemming_col], errors="coerce").to_numpy(dtype=float)
    base_angle = pd.to_numeric(drawn["angulo_trajeto_graus"], errors="coerce").to_numpy(dtype=float)
    base_carga_linear = pd.to_numeric(drawn["carga_linear_kg_m"], errors="coerce").to_numpy(dtype=float)
    base_lmax = pd.to_numeric(terrock_lmax(k, drawn["carga_linear_kg_m"], drawn[stemming_col], drawn["angulo_trajeto_graus"], gravity), errors="coerce").to_numpy(dtype=float)
    charge_sim = base_charge * (1 - red_pct / 100)
    column_sim = pd.to_numeric(drawn["profundidade_m"], errors="coerce").to_numpy(dtype=float) - stem_sim
    valid = np.isfinite(charge_sim) & np.isfinite(column_sim) & np.isfinite(angle_sim) & np.isfinite(base_charge) & np.isfinite(base_distance)
    valid &= (charge_sim > 0) & (column_sim > 0) & (stem_sim > 0) & (angle_sim > 0) & (angle_sim < 90)
    carga_linear_sim = np.where(valid, charge_sim / column_sim, np.nan)
    lmax_sim = np.full(n, np.nan, dtype=float)
    if valid.any():
        lmax_sim[valid] = pd.to_numeric(
            terrock_lmax(k, pd.Series(carga_linear_sim[valid]), pd.Series(stem_sim[valid]), pd.Series(angle_sim[valid]), gravity),
            errors="coerce",
        ).to_numpy(dtype=float)
    samples = pd.DataFrame(
        {
            "desmonte": drawn.get("desmonte"),
            "id_furo": drawn.get("id_furo"),
            "lmax_base_m": base_lmax,
            "lmax_simulado_m": lmax_sim,
            "distancia_observada_m": base_distance,
            "tampao_simulado_m": stem_sim,
            "reducao_carga_percent": red_pct,
            "angulo_simulado_graus": angle_sim,
            "carga_linear_simulada_kg_m": carga_linear_sim,
            "carga_simulada_kg": charge_sim,
            "baseline_charge_linear_kg_m": base_carga_linear,
            "baseline_tampao_m": base_tampao,
            "baseline_angle_graus": base_angle,
            "valid_draw": valid,
        }
    )
    invalid_count = int((~valid).sum())
    valid_samples = samples[samples["valid_draw"]].copy()
    if valid_samples.empty:
        return {
            "samples": samples,
            "summary": pd.DataFrame(),
            "discarded": Counter({"invalid_draw": invalid_count}),
            "seed": seed,
            "n_requested": n,
            "n_valid": 0,
            "n_discarded": invalid_count,
        }
    percentiles = summary_percentiles or [50, 75, 90, 95, 99]
    percentile_rows = [
        {"percentil": p, "lmax_simulado_m": float(np.nanpercentile(valid_samples["lmax_simulado_m"], p))}
        for p in percentiles
    ]
    prob_people: dict[float, float] = {}
    prob_equipment: dict[float, float] = {}
    summary = {
        "seed": seed,
        "n_requested": n,
        "n_valid": int(len(valid_samples)),
        "n_discarded": invalid_count,
        "mean_lmax_m": float(valid_samples["lmax_simulado_m"].mean()),
        "std_lmax_m": float(valid_samples["lmax_simulado_m"].std()),
        "min_lmax_m": float(valid_samples["lmax_simulado_m"].min()),
        "max_lmax_m": float(valid_samples["lmax_simulado_m"].max()),
        "percentiles": percentile_rows,
        "prob_exceder_raio_pessoas": prob_people,
        "prob_exceder_raio_equipamentos": prob_equipment,
        "base_vs_simulado": {
            "media_base_m": float(np.nanmean(base_lmax)),
            "media_simulada_m": float(valid_samples["lmax_simulado_m"].mean()),
        },
    }
    if target_people_radius_m is not None:
        targets = target_people_radius_m if isinstance(target_people_radius_m, list) else [target_people_radius_m]
        for target in targets:
            allowed = float(target) / float(people_factor)
            prob_people[float(target)] = float((valid_samples["lmax_simulado_m"] > allowed).mean())
            equipment_allowed = float(target) * float(equipment_factor) / float(people_factor)
            prob_equipment[float(target)] = float((valid_samples["lmax_simulado_m"] > equipment_allowed).mean())
    return {
        "samples": samples,
        "summary": summary,
        "summary_table": pd.DataFrame(percentile_rows),
        "discarded": Counter({"invalid_draw": invalid_count}),
        "seed": seed,
        "n_requested": n,
        "n_valid": int(len(valid_samples)),
        "n_discarded": invalid_count,
    }


def monte_carlo_lmax(df: pd.DataFrame, k: float, n: int = 10000, seed: int = 42, gravity: float = 9.80665) -> pd.Series:
    result = simulate_monte_carlo(df, k, n=n, seed=seed, gravity=gravity)
    samples = cast(pd.DataFrame, result["samples"])
    return pd.to_numeric(samples.get("lmax_simulado_m", pd.Series(dtype=float)), errors="coerce")
