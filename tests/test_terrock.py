import math
import pandas as pd

from src.models.terrock import calculate_k_event, terrock_lmax


def test_lmax_and_k_roundtrip():
    k = 12.0
    cl = pd.Series([20.0])
    ds = pd.Series([3.0])
    angle = pd.Series([45.0])
    lmax = terrock_lmax(k, cl, ds, angle).iloc[0]
    recovered = calculate_k_event(pd.Series([lmax]), cl, ds, angle).iloc[0]
    assert math.isclose(recovered, k, rel_tol=1e-6)
