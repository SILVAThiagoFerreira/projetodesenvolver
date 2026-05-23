from pathlib import Path

from jinja2 import Template


HTML_TEMPLATE = """
<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Relatorio Flyrock</title>
<style>body{font-family:Arial,sans-serif;margin:36px;color:#1f2933} h1,h2{color:#003c46} table{border-collapse:collapse;width:100%;margin:12px 0} td,th{border:1px solid #d8dee4;padding:6px;font-size:12px} .warn{background:#fff7d6;padding:12px;border-left:4px solid #d99a00}</style></head>
<body>
{% macro render_rows(rows) -%}
{% if rows %}
<table><tr>{% for k in rows[0].keys() %}<th>{{ k }}</th>{% endfor %}</tr>{% for row in rows %}<tr>{% for v in row.values() %}<td>{{ v }}</td>{% endfor %}</tr>{% endfor %}</table>
{% else %}
<p>Sem dados.</p>
{% endif %}
{%- endmacro %}
<h1>{{ config.project.name }}</h1>
<p><strong>Mina:</strong> {{ config.project.mine_name }} | <strong>Gerado em:</strong> {{ generated_at }} | <strong>Versao:</strong> {{ model_version }}</p>
<div class="warn">Ferramenta de analise e apoio a decisao. Os resultados dependem da qualidade da base historica, exigem validacao continua com novos desmontes e nao substituem responsavel tecnico habilitado.</div>
<h2>Sumario executivo</h2>
<p>O sistema normalizou planos de fogo e monitoramento, calibrou o modelo Terrock, estimou distancias maximas e calculou raios de seguranca para pessoas e equipamentos.</p>
<h2>Base de dados utilizada</h2>
<table><tr><th>Indicador</th><th>Valor</th></tr>{% for k,v in match_report.items() %}<tr><td>{{ k }}</td><td>{{ v }}</td></tr>{% endfor %}</table>
<h2>Qualidade dos dados</h2>
{{ render_rows(quality_rows) }}
<h2>Metodologia</h2>
<p>Lmax = (K^2/g) * ((sqrt(CL)/sqrt(DS))^2.6) * sin^2(theta), com CL = carga realizada / coluna carregada.</p>
<h2>Calibracao do modelo</h2>
<table><tr><th>Metrica</th><th>Valor</th></tr>{% for k,v in metrics.items() %}<tr><td>{{ k }}</td><td>{{ "%.4f"|format(v) if v==v else "" }}</td></tr>{% endfor %}</table>
{{ render_rows(calibration_rows) }}
{% if calibration_groups %}
<h3>Calibracao por litologia</h3>
{{ render_rows(calibration_groups) }}
{% endif %}
{% if calibration_rankings %}
<h3>Eventos mais influentes</h3>
{{ render_rows(calibration_rankings) }}
{% endif %}
<h2>Monte Carlo</h2>
{{ render_rows(monte_carlo_rows) }}
{% if monte_carlo_percentiles %}
<h3>Percentis simulados</h3>
{{ render_rows(monte_carlo_percentiles) }}
{% endif %}
{% if monte_carlo_people_risk %}
<h3>Risco para pessoas</h3>
{{ render_rows(monte_carlo_people_risk) }}
{% endif %}
{% if monte_carlo_equipment_risk %}
<h3>Risco para equipamentos</h3>
{{ render_rows(monte_carlo_equipment_risk) }}
{% endif %}
<h2>Raios de seguranca</h2>
{{ render_rows(safety_rows) }}
<h2>Simulacoes para os alvos configurados</h2>
{{ render_rows(inverse_rows) }}
<h2>Proposta de plano de fogo controlado</h2>
<p>Usar as combinacoes de tampao e carga linear simuladas como triagem tecnica. Alteracoes geometricas de afastamento e espacamento devem ser avaliadas separadamente por engenharia de perfuracao e desmonte.</p>
<h2>Limitacoes e recomendacoes</h2>
<p>O modelo e empirico, sensivel a angulo, tampao, carga linear, litologia e qualidade dos registros. Recomenda-se recalibracao a cada campanha e investigacao formal de outliers antes de qualquer remocao.</p>
</body></html>
"""


def render_html_report(context: dict, output_path: str | Path = "reports/outputs/relatorio_flyrock.html") -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(Template(HTML_TEMPLATE).render(**context), encoding="utf-8")
    return output
