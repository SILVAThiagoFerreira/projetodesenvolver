import pandas as pd

from src.data.loaders import merge_modeling_base


def test_merge_report():
    plans = pd.DataFrame({"desmonte": ["FOGO1"], "id_furo": ["F1"], "litologia": ["ITB"]})
    mon = pd.DataFrame({"desmonte": ["FOGO1", "FOGO1"], "id_furo": ["F1", "F2"]})
    merged, report = merge_modeling_base(plans, mon)
    assert len(merged) == 2
    assert report["eventos_sem_correspondencia"] == 1
