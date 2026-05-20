from pathlib import Path

import pandas as pd
import yaml


def export_processed(plans: pd.DataFrame, monitoring: pd.DataFrame, modeling: pd.DataFrame, output_dir: str | Path = "data/processed") -> None:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    plans.to_csv(out / "base_planos_normalizada.csv", index=False, encoding="utf-8-sig")
    monitoring.to_csv(out / "base_monitoramento_normalizada.csv", index=False, encoding="utf-8-sig")
    modeling.to_csv(out / "base_modelagem.csv", index=False, encoding="utf-8-sig")
    modeling.to_excel(out / "base_modelagem_com_resultados.xlsx", index=False)


def export_yaml(payload: dict, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(payload, fh, sort_keys=False, allow_unicode=True)
