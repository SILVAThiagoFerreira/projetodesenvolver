import pandas as pd
import plotly.express as px
import plotly.graph_objects as go


def histogram(df: pd.DataFrame, column: str) -> go.Figure:
    return px.histogram(df, x=column, marginal="box", title=f"Distribuicao de {column}")


def scatter(df: pd.DataFrame, x: str, y: str, color: str = "litologia") -> go.Figure:
    return px.scatter(df, x=x, y=y, color=color if color in df else None, trendline="ols", title=f"{y} versus {x}")


def observed_vs_predicted(df: pd.DataFrame) -> go.Figure:
    fig = px.scatter(df, x="distancia_horizontal_m", y="lmax_previsto_m", color="litologia", title="Observado versus previsto")
    lim = max(df["distancia_horizontal_m"].max(), df["lmax_previsto_m"].max())
    fig.add_trace(go.Scatter(x=[0, lim], y=[0, lim], mode="lines", name="1:1"))
    return fig


def correlation_matrix(df: pd.DataFrame, columns: list[str]) -> go.Figure:
    corr = df[[c for c in columns if c in df]].corr(numeric_only=True)
    return px.imshow(corr, text_auto=True, title="Matriz de correlacao")


def sensitivity_tornado(rows: pd.DataFrame) -> go.Figure:
    return px.bar(rows, x="impacto_m", y="parametro", orientation="h", title="Sensibilidade tipo tornado")
