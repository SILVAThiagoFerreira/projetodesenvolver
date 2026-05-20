from datetime import datetime
from pathlib import Path
import hashlib

import pandas as pd


def file_hash(path: str | Path) -> str:
    path = Path(path)
    if not path.exists():
        return ""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_report_context(config: dict, match_report: dict, metrics: dict, safety: pd.DataFrame, inverse: pd.DataFrame) -> dict:
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "model_version": "0.1.0",
        "config": config,
        "match_report": match_report,
        "metrics": metrics,
        "safety_rows": safety.to_dict("records"),
        "inverse_rows": inverse.head(30).to_dict("records"),
    }
