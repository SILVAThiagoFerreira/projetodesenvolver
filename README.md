# Projeto Desenvolver - Flyrock

Sistema local e web para análise de dados de perfuração e desmonte, calibração do modelo Terrock, previsão de ultralançamento/flyrock, simulação de raios de segurança e emissão de relatórios técnicos.

## Objetivo técnico

O projeto normaliza planos de fogo e monitoramento, une as bases por `Desmonte` e `ID Furo`, valida inconsistências, calcula atributos de engenharia, calibra a constante `K`, calcula `Lmax`, simula cenários calibrados de 700 m para pessoas e 300 m para equipamentos e gera saídas auditáveis.

O sistema é ferramenta de análise e apoio à decisão. Não substitui a responsabilidade técnica de engenheiros habilitados.

## Modos de uso

- Aplicação Python local: `streamlit run app/streamlit_app.py`
- Site GitHub Pages: aplicação estática em `docs/`, com upload dos Excel e processamento no navegador

## Estrutura esperada dos arquivos

- `data/raw/Apendice_I_Planos_de_fogo.xlsx`: múltiplas abas `Fogo1`, `Fogo2`, etc., com variáveis nas linhas e furos nas colunas.
- `data/raw/Apendice_II_Banco_de_dados_monitoramento.xlsx`: aba `BD_Geral` com eventos de flyrock.
- `reports/templates/Template - Relatório.docx`: template opcional.

## Instalação local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
streamlit run app/streamlit_app.py
pytest
ruff check .
mypy src
```

No Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
streamlit run app/streamlit_app.py
pytest
```

## Configuração

Edite `configs/default.yaml` ou selecione outro YAML na interface. Os parâmetros controlam gravidade, método de calibração de `K`, uso de litologia, fatores de segurança calibrados, outliers, Monte Carlo e formatos de relatório.

## Interpretação

- `K_evento`: constante calibrada por evento histórico.
- `K_global`: constante consolidada por média, mediana, percentil, média aparada ou mínimos quadrados.
- `Lmax previsto`: distância horizontal estimada pelo modelo Terrock.
- `raio pessoas`: `Lmax referência * fator de segurança para pessoas`.
- `raio equipamentos`: `Lmax referência * fator de segurança para equipamentos`.
- Simulação inversa: estima tampão e carga necessários para atingir limites de `Lmax` derivados de raios-alvo.

## Exportações

O pipeline Python gera:

- `data/processed/base_planos_normalizada.csv`
- `data/processed/base_monitoramento_normalizada.csv`
- `data/processed/base_modelagem.csv`
- `data/processed/base_modelagem_com_resultados.xlsx`
- `reports/outputs/relatorio_flyrock.html`
- `reports/outputs/relatorio_flyrock.pdf`, quando `weasyprint` estiver disponível
- `reports/outputs/relatorio_flyrock.docx`
- `reports/outputs/tabela_cenarios.csv`
- `reports/outputs/config_usada.yaml`

## GitHub Pages

O site está em `docs/` e é publicado pelo workflow `.github/workflows/pages.yml`. A versão web usa JavaScript no navegador para ler os Excel, calcular os indicadores principais, gerar gráficos e baixar CSV/HTML.

## Limitações

O modelo é empírico e sensível à qualidade dos registros, ao ângulo de lançamento, tampão, carga linear, litologia e correspondência entre bases. Outliers são sinalizados, não removidos automaticamente. Qualquer alteração operacional de desmonte exige validação técnica formal.

## Aviso de responsabilidade técnica

Este projeto não é plano executivo de fogo, autorização operacional, ART ou laudo de segurança. Os resultados devem ser revisados por profissional habilitado e recalibrados continuamente com novos desmontes monitorados.
