from pathlib import Path
from shutil import copy2

from src.config.settings import load_config
from src.pipeline import run_pipeline


def test_run_pipeline_populates_lmax_before_downstream_metrics(tmp_path):
    root = Path(__file__).resolve().parents[1]
    raw = tmp_path / "data" / "raw"
    raw.mkdir(parents=True)
    for name in (
        "Apendice_I_Planos_de_fogo.xlsx",
        "Apendice_II_Banco_de_dados_monitoramento.xlsx",
    ):
        copy2(root / "data" / "raw" / name, raw / name)
    config = load_config(root / "configs" / "default.yaml")

    result = run_pipeline(config, tmp_path)

    modeled = result["modeled"]
    assert "lmax_previsto_m" in modeled.columns
    assert int(modeled["lmax_previsto_m"].notna().sum()) == 72
    assert result["metrics"]["n_total"] == 72
    assert not result["safety"].empty
    assert not result["inverse"].empty
    assert result["html"].exists()
    assert result["docx"].exists()
