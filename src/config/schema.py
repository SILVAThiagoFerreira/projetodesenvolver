from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_default=True)


class ProjectConfig(StrictModel):
    name: str = "Modelo de Previsão de Flyrock"
    mine_name: str = "Pequena Mina Vale"
    language: str = "pt-BR"


class FilesConfig(StrictModel):
    blast_plan_path: Path = Path("data/raw/Apendice_I_Planos_de_fogo.xlsx")
    monitoring_path: Path = Path("data/raw/Apendice_II_Banco_de_dados_monitoramento.xlsx")
    report_template_path: Path = Path("reports/templates/Template - Relatório.docx")


class ModelConfig(StrictModel):
    gravity: float = Field(default=9.80665, gt=0)
    k_calibration_method: Literal["mean", "median", "trimmed_mean", "percentile", "least_squares"] = "median"
    group_by_lithology: bool = True
    use_real_stemming: bool = True
    use_real_charge: bool = True
    default_angle_when_missing: float | None = None
    prediction_percentile: int = Field(default=95, ge=1, le=99)

    @model_validator(mode="after")
    def validate_default_angle(self) -> ModelConfig:
        if self.default_angle_when_missing is not None and not 0 < self.default_angle_when_missing < 90:
            raise ValueError("default_angle_when_missing deve estar entre 0 e 90 graus")
        return self


class SafetyConfig(StrictModel):
    equipment_factor: float = Field(default=2.0, gt=0)
    people_factor: float = Field(default=14 / 3, gt=0)
    target_people_radius_m: list[float] = Field(default_factory=lambda: [600.0, 500.0])

    @field_validator("target_people_radius_m")
    @classmethod
    def validate_targets(cls, value: list[float]) -> list[float]:
        if not value:
            raise ValueError("target_people_radius_m não pode estar vazio")
        if any(v <= 0 for v in value):
            raise ValueError("target_people_radius_m deve conter apenas valores positivos")
        return value


class OutliersConfig(StrictModel):
    method: Literal["iqr", "zscore", "percentile", "hybrid"] = "iqr"
    iqr_multiplier: float = Field(default=1.5, gt=0)
    zscore_threshold: float = Field(default=3.0, gt=0)
    percentile_low: float = Field(default=0.05, ge=0, le=1)
    percentile_high: float = Field(default=0.95, ge=0, le=1)
    remove_outliers: bool = False
    flag_outliers: bool = True

    @model_validator(mode="after")
    def validate_percentiles(self) -> OutliersConfig:
        if self.percentile_low >= self.percentile_high:
            raise ValueError("percentile_low deve ser menor que percentile_high")
        return self


class RangeConfig(StrictModel):
    min: float
    max: float
    step: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_bounds(self) -> RangeConfig:
        if self.max < self.min:
            raise ValueError("max deve ser maior ou igual a min")
        return self


class SimulationConfig(StrictModel):
    n_monte_carlo: int = Field(default=10000, gt=0)
    random_seed: int = 42
    stemming_range_m: RangeConfig = Field(default_factory=lambda: RangeConfig(min=2.0, max=6.0, step=0.1))
    charge_reduction_percent: RangeConfig = Field(default_factory=lambda: RangeConfig(min=0, max=40, step=5))
    angle_range_degrees: RangeConfig = Field(default_factory=lambda: RangeConfig(min=5, max=85, step=5))
    summary_percentiles: list[int] = Field(default_factory=lambda: [50, 75, 90, 95, 99])

    @field_validator("summary_percentiles")
    @classmethod
    def validate_summary_percentiles(cls, value: list[int]) -> list[int]:
        if not value:
            raise ValueError("summary_percentiles não pode estar vazio")
        if any(p <= 0 or p >= 100 for p in value):
            raise ValueError("summary_percentiles deve conter valores entre 0 e 100")
        return sorted(dict.fromkeys(value))


def _default_output_formats() -> list[Literal["html", "pdf", "docx", "csv"]]:
    return ["html", "pdf", "docx"]


class ReportConfig(StrictModel):
    output_formats: list[Literal["html", "pdf", "docx", "csv"]] = Field(default_factory=_default_output_formats)
    include_charts: bool = True
    include_data_quality_section: bool = True
    include_engineering_disclaimer: bool = True


class UnitsConfig(StrictModel):
    distance: Literal["m"] = "m"
    mass: Literal["kg"] = "kg"
    density: Literal["g/cm3", "g/cm³"] = "g/cm3"
    angle: Literal["degrees"] = "degrees"
    coordinate: Literal["utm", "geographic"] = "utm"
    radius: Literal["m"] = "m"
    horizontal_distance: Literal["m"] = "m"


class AppConfig(StrictModel):
    project: ProjectConfig = Field(default_factory=ProjectConfig)
    files: FilesConfig = Field(default_factory=FilesConfig)
    model: ModelConfig = Field(default_factory=ModelConfig)
    safety: SafetyConfig = Field(default_factory=SafetyConfig)
    outliers: OutliersConfig = Field(default_factory=OutliersConfig)
    simulation: SimulationConfig = Field(default_factory=SimulationConfig)
    report: ReportConfig = Field(default_factory=ReportConfig)
    units: UnitsConfig = Field(default_factory=UnitsConfig)
