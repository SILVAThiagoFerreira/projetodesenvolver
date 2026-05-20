import numpy as np
import pandas as pd
from scipy import stats


DISTROS = {"normal": stats.norm, "lognormal": stats.lognorm, "gamma": stats.gamma, "weibull": stats.weibull_min, "exponencial": stats.expon}


def descriptive_statistics(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    rows = []
    for col in columns:
        s = pd.to_numeric(df[col], errors="coerce") if col in df else pd.Series(dtype=float)
        q = s.quantile([0.25, 0.5, 0.75])
        rows.append({
            "variavel": col, "media": s.mean(), "mediana": s.median(), "desvio_padrao": s.std(),
            "coef_variacao": s.std() / s.mean() if s.mean() else np.nan, "minimo": s.min(), "maximo": s.max(),
            "q1": q.get(0.25, np.nan), "q2": q.get(0.5, np.nan), "q3": q.get(0.75, np.nan),
            "assimetria": s.skew(), "curtose": s.kurt(), "faltantes": int(s.isna().sum()),
            "outliers": int(df.loc[df.get("is_outlier", False) == True, col].count()) if col in df else 0,
        })
    return pd.DataFrame(rows)


def fit_distributions(series: pd.Series) -> pd.DataFrame:
    x = pd.to_numeric(series, errors="coerce").dropna()
    rows = []
    if len(x) < 3:
        return pd.DataFrame()
    for name, dist in DISTROS.items():
        try:
            params = dist.fit(x)
            loglik = np.sum(dist.logpdf(x, *params))
            k = len(params)
            aic = 2 * k - 2 * loglik
            bic = k * np.log(len(x)) - 2 * loglik
            ks_stat, ks_pvalue = stats.kstest(x, dist.cdf, args=params)
            rows.append({"distribuicao": name, "aic": aic, "bic": bic, "ks_stat": ks_stat, "ks_pvalue": ks_pvalue, "parametros": params})
        except Exception:
            continue
    return pd.DataFrame(rows).sort_values(["aic", "bic"], ignore_index=True)
