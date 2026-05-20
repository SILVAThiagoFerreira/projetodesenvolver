import pandas as pd


def to_numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(
        series.astype(str).str.replace(",", ".", regex=False).str.replace("nan", "", regex=False),
        errors="coerce",
    )
