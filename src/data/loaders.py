from pathlib import Path

import pandas as pd

from src.data.normalizers import normalize_blast_sheet, normalize_monitoring


def _is_blast_sheet(name: str) -> bool:
    slug = str(name).strip().lower()
    return slug.startswith("fogo") or "desmonte" in slug or "plano" in slug


def load_blast_plans(path: str | Path) -> pd.DataFrame:
    sheets = pd.read_excel(path, sheet_name=None, header=None)
    frames = [normalize_blast_sheet(df, name) for name, df in sheets.items() if _is_blast_sheet(name)]
    if not frames:
        frames = [normalize_blast_sheet(df, name) for name, df in sheets.items()]
    frames = [f for f in frames if not f.empty]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def load_monitoring(path: str | Path, sheet_name: str = "BD_Geral") -> pd.DataFrame:
    return normalize_monitoring(pd.read_excel(path, sheet_name=sheet_name))


def merge_modeling_base(plans: pd.DataFrame, monitoring: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, float]]:
    duplicated = int(plans.duplicated(["desmonte", "id_furo"]).sum()) if not plans.empty else 0
    plans_for_merge = plans.drop_duplicates(["desmonte", "id_furo"], keep="first")
    merged = monitoring.merge(plans_for_merge, on=["desmonte", "id_furo"], how="left", indicator=True)
    matched = int((merged["_merge"] == "both").sum())
    total = int(len(monitoring))
    report = {
        "eventos_monitoramento": total,
        "furos_plano": int(len(plans)),
        "eventos_sem_correspondencia": int((merged["_merge"] == "left_only").sum()),
        "furos_duplicados": duplicated,
        "desmontes_nao_encontrados": int(merged.loc[merged["_merge"] == "left_only", "desmonte"].nunique()),
        "percentual_match": float(matched / total * 100) if total else 0.0,
    }
    return merged.drop(columns=["_merge"]), report
