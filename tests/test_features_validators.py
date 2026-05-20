import pandas as pd

from src.features.engineering import add_engineering_features
from src.data.validators import validate_modeling_data


def test_engineering_and_invalid_data():
    df = pd.DataFrame({"profundidade_m": [10, 2], "tampao_real_m": [3, 3], "carga_realizada_kg": [140, -1], "afastamento_m": [4, 4], "espacamento_m": [5, 5], "densidade_litologica_g_cm3": [2.7, 2.7], "distancia_horizontal_m": [100, 0], "angulo_trajeto_graus": [45, 91], "litologia": ["ITB", ""], "desmonte": ["FOGO1", "FOGO1"], "id_furo": ["F1", "F2"]})
    eng = add_engineering_features(df)
    assert eng.loc[0, "coluna_carregada_m"] == 7
    assert eng.loc[0, "carga_linear_kg_m"] == 20
    val = validate_modeling_data(df)
    assert val.loc[1, "validation_status"] == "invalid"
