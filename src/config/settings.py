from pathlib import Path

import yaml
from pydantic import ValidationError

from src.config.schema import AppConfig
from src.utils.exceptions import ConfigurationError


def load_config(path: str | Path = "configs/default.yaml") -> AppConfig:
    path = Path(path)
    if not path.exists():
        raise ConfigurationError(f"Arquivo de configuração não encontrado: {path}")
    try:
        with path.open("r", encoding="utf-8") as fh:
            payload = yaml.safe_load(fh) or {}
    except yaml.YAMLError as exc:
        raise ConfigurationError(f"YAML inválido em {path}: {exc}") from exc
    try:
        return AppConfig.model_validate(payload)
    except ValidationError as exc:
        raise ConfigurationError(f"Configuração inválida em {path}: {exc}") from exc


def save_config(config: AppConfig, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(config.model_dump(mode="json"), fh, sort_keys=False, allow_unicode=True)
