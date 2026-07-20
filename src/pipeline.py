from pathlib import Path

import pandas as pd

from src.config.schema import AppConfig
from src.data.exporters import export_processed, export_yaml
from src.data.loaders import load_blast_plans, load_monitoring, merge_modeling_base
from src.data.validators import flag_outliers, validate_modeling_data
from src.features.engineering import add_engineering_features
from src.models.audit import build_calculation_trace
from src.models.calibration import calibrate_k, calibration_summary
from src.models.metrics import regression_metrics
from src.models.terrock import add_terrock_results, calculate_k_event
from src.reporting.docx_report import render_docx_report
from src.reporting.html_report import render_html_report
from src.reporting.pdf_report import render_pdf_report
from src.reporting.report_context import build_report_context
from src.simulation.monte_carlo import simulate_monte_carlo
from src.simulation.inverse_design import inverse_design_table
from src.simulation.scenarios import safety_table


OUTLIER_COLUMNS = ["distancia_horizontal_m", "carga_usada_kg", "tampao_usado_m", "carga_linear_kg_m", "k_evento"]


def run_pipeline(config: AppConfig, base_dir: str | Path = ".") -> dict:
    base = Path(base_dir)
    plans = load_blast_plans(base / config.files.blast_plan_path)
    monitoring = load_monitoring(base / config.files.monitoring_path)
    merged, match_report = merge_modeling_base(plans, monitoring)
    modeled = add_engineering_features(
        validate_modeling_data(
            merged,
            default_angle_when_missing=config.model.default_angle_when_missing,
            use_real_stemming=config.model.use_real_stemming,
            use_real_charge=config.model.use_real_charge,
        ),
        use_real_stemming=config.model.use_real_stemming,
        use_real_charge=config.model.use_real_charge,
    )
    modeled["k_evento"] = calculate_k_event(
        modeled["distancia_horizontal_m"],
        modeled["carga_linear_kg_m"],
        modeled["tampao_usado_m"],
        modeled["angulo_trajeto_graus"],
        config.model.gravity,
    )
    if config.outliers.flag_outliers:
        modeled = flag_outliers(modeled, OUTLIER_COLUMNS, config.outliers.method, config.outliers.iqr_multiplier, config.outliers.zscore_threshold)
    else:
        modeled["outlier_reason"] = ""
        modeled["is_outlier"] = False
        modeled["outlier_method"] = "disabled"

    modeled["outlier_included"] = True
    if config.outliers.remove_outliers and "is_outlier" in modeled.columns:
        modeled.loc[modeled["is_outlier"], "outlier_included"] = False

    analysis_base = modeled[modeled["validation_calculable"]].copy()
    if config.outliers.remove_outliers and "is_outlier" in analysis_base.columns:
        analysis_base = analysis_base[~analysis_base["is_outlier"]].copy()

    k_global = calibrate_k(analysis_base, config.model.k_calibration_method, None, config.model.prediction_percentile, config.model.gravity)
    if config.model.group_by_lithology and "litologia" in analysis_base.columns:
        k_by_lithology = calibrate_k(analysis_base, config.model.k_calibration_method, "litologia", config.model.prediction_percentile, config.model.gravity)
        k_series = modeled["litologia"].map(k_by_lithology).fillna(k_global)
        k_summary = calibration_summary(analysis_base, config.model.k_calibration_method, "litologia", config.model.prediction_percentile, config.model.gravity)
    else:
        k_by_lithology = pd.Series(dtype=float)
        k_series = k_global
        k_summary = calibration_summary(analysis_base, config.model.k_calibration_method, None, config.model.prediction_percentile, config.model.gravity)
    k_summary["k_global"] = float(k_global) if pd.notna(k_global) else float("nan")
    modeled = add_terrock_results(modeled, k_series, config.model.gravity)
    # Keep the calibration/outlier subset, now including the Terrock outputs.
    # Metrics and simulations consume lmax_previsto_m, which is added above.
    analysis_base = modeled.loc[analysis_base.index].copy()
    config_snapshot = config.model_dump(mode="json")
    modeled["calculation_trace"] = [
        build_calculation_trace(
            row,
            k_used=row.get("k_aplicado"),
            k_method=config.model.k_calibration_method,
            k_source="k_by_lithology" if config.model.group_by_lithology and "litologia" in row.index and row.get("litologia") in getattr(k_by_lithology, "index", []) else "k_global",
            gravity=config.model.gravity,
            config_snapshot=config_snapshot,
        )
        for _, row in modeled.iterrows()
    ]
    metrics = regression_metrics(analysis_base["distancia_horizontal_m"], analysis_base["lmax_previsto_m"])
    safety = safety_table(analysis_base, config.safety.equipment_factor, config.safety.people_factor)
    inverse = inverse_design_table(analysis_base, float(k_global), config.safety.target_people_radius_m, config.safety.people_factor, config.model.gravity)
    monte_carlo = simulate_monte_carlo(
        analysis_base,
        float(k_global) if pd.notna(k_global) else float("nan"),
        n=config.simulation.n_monte_carlo,
        seed=config.simulation.random_seed,
        gravity=config.model.gravity,
        stemming_range_m=config.simulation.stemming_range_m,
        charge_reduction_percent=config.simulation.charge_reduction_percent,
        angle_range_degrees=config.simulation.angle_range_degrees,
        target_people_radius_m=config.safety.target_people_radius_m,
        people_factor=config.safety.people_factor,
        equipment_factor=config.safety.equipment_factor,
        summary_percentiles=config.simulation.summary_percentiles,
    )
    export_processed(plans, monitoring, modeled, base / "data/processed")
    out_dir = base / "reports/outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    inverse.to_csv(out_dir / "tabela_cenarios.csv", index=False, encoding="utf-8-sig")
    summary_table = monte_carlo.get("summary_table")
    if isinstance(summary_table, pd.DataFrame) and not summary_table.empty:
        summary_table.to_csv(out_dir / "simulacao_monte_carlo_percentis.csv", index=False, encoding="utf-8-sig")
    export_yaml(config_snapshot, out_dir / "config_usada.yaml")
    quality_summary = {
        "total_registros": int(len(modeled)),
        "valid": int((modeled["validation_status"] == "valid").sum()) if "validation_status" in modeled.columns else 0,
        "warning": int((modeled["validation_status"] == "warning").sum()) if "validation_status" in modeled.columns else 0,
        "invalid": int((modeled["validation_status"] == "invalid").sum()) if "validation_status" in modeled.columns else 0,
        "critical": int((modeled["validation_status"] == "critical").sum()) if "validation_status" in modeled.columns else 0,
        "calculavel": int(modeled["validation_calculable"].sum()) if "validation_calculable" in modeled.columns else 0,
        "outliers": int(modeled["is_outlier"].sum()) if "is_outlier" in modeled.columns else 0,
    }
    context = build_report_context(config_snapshot, match_report, metrics, safety, inverse, k_summary, monte_carlo, quality_summary)
    html = render_html_report(context, out_dir / "relatorio_flyrock.html")
    pdf = render_pdf_report(html, out_dir / "relatorio_flyrock.pdf")
    docx = render_docx_report(context, out_dir / "relatorio_flyrock.docx")
    return {"plans": plans, "monitoring": monitoring, "modeled": modeled, "match_report": match_report, "k_global": k_global, "k_by_lithology": k_by_lithology, "k_summary": k_summary, "monte_carlo": monte_carlo, "metrics": metrics, "safety": safety, "inverse": inverse, "html": html, "pdf": pdf, "docx": docx}
