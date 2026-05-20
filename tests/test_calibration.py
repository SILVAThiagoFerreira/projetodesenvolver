import pandas as pd

from src.models.calibration import calibrate_k


def test_calibrate_median_and_group():
    df = pd.DataFrame({"k_evento": [10, 20, 30], "litologia": ["A", "A", "B"], "carga_linear_kg_m": [1, 1, 1], "tampao_real_m": [1, 1, 1], "angulo_trajeto_graus": [45, 45, 45], "distancia_horizontal_m": [1, 2, 3]})
    assert calibrate_k(df, "median") == 20
    grouped = calibrate_k(df, "median", "litologia")
    assert grouped.loc["A"] == 15
