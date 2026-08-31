import math

import pandas as pd

from src.simulation.inverse_design import inverse_design_for_target
from src.simulation.scenarios import calculate_safety_radius


def test_safety_radius():
    row = calculate_safety_radius(164.42, 2, 4, "maximo_observado")
    assert math.isclose(row["raio_equipamentos_m"], 328.84, rel_tol=1e-9)
    assert math.isclose(row["raio_pessoas_m"], 657.68, rel_tol=1e-9)


def test_inverse_design_targets():
    sample = pd.Series({"carga_linear_kg_m": 20, "tampao_real_m": 3, "angulo_trajeto_graus": 45, "coluna_carregada_m": 7, "carga_realizada_kg": 140, "profundidade_m": 10})
    out600 = inverse_design_for_target(sample, 12, 600, 4)
    out500 = inverse_design_for_target(sample, 12, 500, 4)
    assert out600["lmax_permitido_m"] == 150
    assert out500["lmax_permitido_m"] == 125
