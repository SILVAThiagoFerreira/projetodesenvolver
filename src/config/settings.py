from pathlib import Path

import yaml

from src.config.schema import AppConfig


def load_config(path: str | Path = "configs/default.yaml") -> AppConfig:
    path = Path(path)
    if not path.exists():
        return AppConfig()
    with path.open("r", encoding="utf-8") as fh:
        payload = yaml.safe_load(fh) or {}
    return AppConfig.model_validate(payload)


def save_config(config: AppConfig, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(config.model_dump(mode="json"), fh, sort_keys=False, allow_unicode=True)
