import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score


def regression_metrics(y_true: pd.Series, y_pred: pd.Series) -> dict[str, float]:
    mask = y_true.notna() & y_pred.notna()
    yt_all, yp_all = y_true[mask], y_pred[mask]
    if yt_all.empty:
        return {}
    nonzero_mask = yt_all != 0
    yt, yp = yt_all[nonzero_mask], yp_all[nonzero_mask]
    err = yp - yt
    return {
        "n_total": float(len(yt_all)),
        "n_zero_truth": float((yt_all == 0).sum()),
        "n_used_for_mape": float(len(yt)),
        "r2": float(r2_score(yt_all, yp_all)) if len(yt_all) > 1 else float("nan"),
        "mae": float(mean_absolute_error(yt_all, yp_all)),
        "rmse": float(np.sqrt(np.mean((yp - yt) ** 2))),
        "mape": float((abs(err / yt) * 100).mean()) if len(yt) else float("nan"),
        "erro_medio": float(err.mean()),
        "erro_mediano": float(err.median()),
        "p90_erro_abs": float(err.abs().quantile(0.90)),
        "p95_erro_abs": float(err.abs().quantile(0.95)),
    }
