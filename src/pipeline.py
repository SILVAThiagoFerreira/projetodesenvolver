from pathlib import Path

import pandas as pd

from src.config.schema import AppConfig
from src.data.exporters import export_processed, export_yaml
from src.data.loaders import load_blast_plans, load_monitoring, merge_modeling_base
from src.data.validators import flag_outliers, validate_modeling_data
from src.features.engineering import add_engineering_features
from src.models.calibration import calibrate_k
from src.models.metrics import regression_metrics
from src.models.terrock import add_terrock_results, calculate_k_event
from src.reporting.docx_report import render_docx_report
from src.reporting.html_report import render_html_report
from src.reporting.pdf_report import render_pdf_report
from src.reporting.report_context import build_report_context
from src.simulation.inverse_design import inverse_design_table
from src.simulation.scenarios import safety_table


OUTLIER_COLUMNS = ["distancia_horizontal_m", "carga_realizada_kg", "tampao_real_m", "carga_linear_kg_m", "k_evento"]


def run_pipeline(config: AppConfig, base_dir: str | Path = ".") -> dict:
    base = Path(base_dir)
    plans = load_blast_plans(base / config.files.blast_plan_path)
    monitoring = load_monitoring(base / config.files.monitoring_path)
    merged, match_report = merge_modeling_base(plans, monitoring)
    modeled = add_engineering_features(validate_modeling_data(merged))
    modeled["k_evento"] = calculate_k_event(
        modeled["distancia_horizontal_m"],
        modeled["carga_linear_kg_m"],
        modeled["tampao_real_m"],
        modeled["angulo_trajeto_graus"],
        config.model.gravity,
    )
    modeled = flag_outliers(modeled, OUTLIER_COLUMNS, config.outliers.method, config.outliers.iqr_multiplier, config.outliers.zscore_threshold)
    valid = modeled[modeled["validation_status"].eq("valid")].copy()
    k_global = calibrate_k(valid, config.model.k_calibration_method, None, config.model.prediction_percentile, config.model.gravity)
    if config.model.group_by_lithology and "litologia" in valid:
        k_by_lithology = calibrate_k(valid, config.model.k_calibration_method, "litologia", config.model.prediction_percentile, config.model.gravity)
        k_series = modeled["litologia"].map(k_by_lithology).fillna(k_global)
    else:
        k_by_lithology = pd.Series(dtype=float)
        k_series = k_global
    modeled = add_terrock_results(modeled, k_series, config.model.gravity)
    metrics = regression_metrics(modeled["distancia_horizontal_m"], modeled["lmax_previsto_m"])
    safety = safety_table(modeled, config.safety.equipment_factor, config.safety.people_factor)
    inverse = inverse_design_table(modeled, float(k_global), config.safety.target_people_radius_m, config.safety.people_factor, config.model.gravity)
    export_processed(plans, monitoring, modeled, base / "data/processed")
    out_dir = base / "reports/outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    inverse.to_csv(out_dir / "tabela_cenarios.csv", index=False, encoding="utf-8-sig")
    export_yaml(config.model_dump(mode="json"), out_dir / "config_usada.yaml")
    context = build_report_context(config.model_dump(mode="json"), match_report, metrics, safety, inverse)
    html = render_html_report(context, out_dir / "relatorio_flyrock.html")
    pdf = render_pdf_report(html, out_dir / "relatorio_flyrock.pdf")
    docx = render_docx_report(context, out_dir / "relatorio_flyrock.docx")
    return {"plans": plans, "monitoring": monitoring, "modeled": modeled, "match_report": match_report, "k_global": k_global, "k_by_lithology": k_by_lithology, "metrics": metrics, "safety": safety, "inverse": inverse, "html": html, "pdf": pdf, "docx": docx}
