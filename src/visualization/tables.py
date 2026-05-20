import pandas as pd


def data_quality_summary(df: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "indicador": ["linhas", "validas", "invalidas", "outliers", "desmontes", "furos"],
            "valor": [
                len(df),
                int(df.get("validation_status", pd.Series()).eq("valid").sum()),
                int(df.get("validation_status", pd.Series()).eq("invalid").sum()),
                int(df.get("is_outlier", pd.Series()).eq(True).sum()),
                int(df["desmonte"].nunique()) if "desmonte" in df else 0,
                int(df["id_furo"].nunique()) if "id_furo" in df else 0,
            ],
        }
    )
