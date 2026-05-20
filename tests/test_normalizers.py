import pandas as pd

from src.data.normalizers import normalize_blast_sheet, normalize_monitoring


def test_normalize_blast_sheet_transposed():
    df = pd.DataFrame({0: ["Desmonte", "ID furo", "Litologia", "Profund. (m)", "Tampão Real (m)", "Carga Realizado (kg)", "Afast. (m)", "Espaç. (m)", "Densidade Litologica (g/cm³)"], 1: ["Fogo1", "F1", "ITB", 10, 3, 100, 4, 5, 2.7]})
    out = normalize_blast_sheet(df, "Fogo1")
    assert out.loc[0, "id_furo"] == "F1"
    assert out.loc[0, "profundidade_m"] == 10


def test_monitoring_forward_fill():
    df = pd.DataFrame({"Desmonte": ["Fogo1", None], "ID Furo": ["F1", "F2"], "Distância Horizontal (m)": [100, 120], "Angle do trajeto": [45, 40]})
    out = normalize_monitoring(df)
    assert out.loc[1, "desmonte"] == "FOGO1"
