from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


class ProjectConfig(BaseModel):
    name: str = "Modelo de Previsao de Flyrock"
    mine_name: str = "Pequena Mina Vale"
    language: str = "pt-BR"


class FilesConfig(BaseModel):
    blast_plan_path: Path = Path("data/raw/Apendice_I_Planos_de_fogo.xlsx")
    monitoring_path: Path = Path("data/raw/Apendice_II_Banco_de_dados_monitoramento.xlsx")
    report_template_path: Path = Path("reports/templates/Template - Relatorio.docx")


class ModelConfig(BaseModel):
    gravity: float = 9.80665
    k_calibration_method: Literal["mean", "median", "trimmed_mean", "percentile", "least_squares"] = "median"
    group_by_lithology: bool = True
    use_real_stemming: bool = True
    use_real_charge: bool = True
    default_angle_when_missing: float | None = None
    prediction_percentile: int = Field(default=95, ge=1, le=99)


class SafetyConfig(BaseModel):
    equipment_factor: float = 2.0
    people_factor: float = 4.0
    target_people_radius_m: list[float] = [600.0, 500.0]


class OutliersConfig(BaseModel):
    method: Literal["iqr", "zscore"] = "iqr"
    iqr_multiplier: float = 1.5
    zscore_threshold: float = 3.0
    remove_outliers: bool = False
    flag_outliers: bool = True


class RangeConfig(BaseModel):
    min: float
    max: float
    step: float


class SimulationConfig(BaseModel):
    n_monte_carlo: int = 10000
    random_seed: int = 42
    stemming_range_m: RangeConfig = RangeConfig(min=2.0, max=6.0, step=0.1)
    charge_reduction_percent: RangeConfig = RangeConfig(min=0, max=40, step=5)
    angle_range_degrees: RangeConfig = RangeConfig(min=5, max=85, step=5)


class ReportConfig(BaseModel):
    output_formats: list[str] = ["html", "pdf", "docx"]
    include_charts: bool = True
    include_data_quality_section: bool = True
    include_engineering_disclaimer: bool = True


class AppConfig(BaseModel):
    project: ProjectConfig = ProjectConfig()
    files: FilesConfig = FilesConfig()
    model: ModelConfig = ModelConfig()
    safety: SafetyConfig = SafetyConfig()
    outliers: OutliersConfig = OutliersConfig()
    simulation: SimulationConfig = SimulationConfig()
    report: ReportConfig = ReportConfig()
