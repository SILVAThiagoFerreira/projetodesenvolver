import math

import pandas as pd

from src.simulation.inverse_design import inverse_design_for_target
from src.simulation.scenarios import calculate_safety_radius


def test_safety_radius():
    row = calculate_safety_radius(164.42, 2, 4, "maximo_observado")
    assert math.isclose(row["raio_equipamentos_m"], 328.84, rel_tol=1e-9)
    assert math.isclose(row["raio_pessoas_m"], 657.68, rel_tol=1e-9)


def test_inverse_design_targets():
    sample = pd.Series({"carga_linear_kg_m": 20, "tampao_real_m": 3, "angulo_trajeto_graus": 45, "coluna_carregada_m": 7, "carga_realizada_kg": 140, "massa_estimativa_t": 280, "profundidade_m": 10, "distancia_horizontal_m": 200})
    out600 = inverse_design_for_target(sample, 12, 600, 4)
    out500 = inverse_design_for_target(sample, 12, 500, 4)
    assert out600["lmax_permitido_m"] == 150
    assert out500["lmax_permitido_m"] == 125
    assert out500["lmax_previsto_atual_m"] == 200
    assert out500["tampao_necessario_m"] > out500["tampao_atual_m"]
    assert out500["carga_necessaria_kg"] < out500["carga_atual_kg"]
    assert out500["razao_carga_com_cme_kg_t"] < out500["razao_carga_atual_kg_t"]
    assert out500["razao_carga_com_tampao_kg_t"] <= out500["razao_carga_atual_kg_t"]
