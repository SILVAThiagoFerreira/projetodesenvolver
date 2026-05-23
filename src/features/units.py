from __future__ import annotations

import numpy as np
import pandas as pd


def to_numeric(series: pd.Series) -> pd.Series:
    """Coerce a pandas Series to numeric values.

    Strings with decimal commas are normalized before conversion.
    Non-numeric values are converted to NaN.
    """

    if series is None:
        return pd.Series(dtype=float)
    cleaned = pd.Series(series, copy=True).astype("string")
    cleaned = cleaned.str.replace(",", ".", regex=False)
    cleaned = cleaned.replace({"nan": pd.NA, "None": pd.NA, "": pd.NA, " ": pd.NA})
    return pd.to_numeric(cleaned, errors="coerce")


def safe_divide(numerator, denominator):
    """Divide two scalar or vector inputs and replace non-finite results with NaN."""

    result = np.divide(numerator, denominator)
    if isinstance(result, pd.Series):
        return result.replace([np.inf, -np.inf], np.nan)
    if isinstance(result, np.ndarray):
        return pd.Series(result).replace([np.inf, -np.inf], np.nan).to_numpy()
    return result if np.isfinite(result) else np.nan
