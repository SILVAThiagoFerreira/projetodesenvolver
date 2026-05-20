import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score


def regression_metrics(y_true: pd.Series, y_pred: pd.Series) -> dict[str, float]:
    mask = y_true.notna() & y_pred.notna() & (y_true != 0)
    yt, yp = y_true[mask], y_pred[mask]
    if yt.empty:
        return {}
    err = yp - yt
    return {
        "r2": float(r2_score(yt, yp)) if len(yt) > 1 else float("nan"),
        "mae": float(mean_absolute_error(yt, yp)),
        "rmse": float(np.sqrt(np.mean((yp - yt) ** 2))),
        "mape": float((abs(err / yt) * 100).mean()),
        "erro_medio": float(err.mean()),
        "erro_mediano": float(err.median()),
        "p90_erro_abs": float(err.abs().quantile(0.90)),
        "p95_erro_abs": float(err.abs().quantile(0.95)),
    }
