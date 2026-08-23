import pandas as pd
import plotly.express as px
import plotly.graph_objects as go


VALE_GRAY = "#77787B"
MINERAL_YELLOW = "#ECB833"
TURQUOISE = "#00939A"
LIGHT_SURFACE = "#F7F7F7"
GRID_COLOR = "#E6E6E6"
DISCRETE_COLORS = [TURQUOISE, MINERAL_YELLOW, VALE_GRAY]
CONTINUOUS_COLORS = [LIGHT_SURFACE, MINERAL_YELLOW, TURQUOISE]


def _style_figure(fig: go.Figure) -> go.Figure:
    fig.update_layout(
        template="plotly_white",
        colorway=DISCRETE_COLORS,
        paper_bgcolor="#FFFFFF",
        plot_bgcolor="#FFFFFF",
        font={"color": VALE_GRAY},
        title_font={"color": VALE_GRAY},
    )
    fig.update_xaxes(gridcolor=GRID_COLOR, zerolinecolor=GRID_COLOR)
    fig.update_yaxes(gridcolor=GRID_COLOR, zerolinecolor=GRID_COLOR)
    return fig


def histogram(df: pd.DataFrame, column: str) -> go.Figure:
    fig = px.histogram(
        df,
        x=column,
        marginal="box",
        title=f"Distribuicao de {column}",
        color_discrete_sequence=[TURQUOISE],
    )
    return _style_figure(fig)


def scatter(df: pd.DataFrame, x: str, y: str, color: str = "litologia") -> go.Figure:
    fig = px.scatter(
        df,
        x=x,
        y=y,
        color=color if color in df else None,
        trendline="ols",
        trendline_color_override=VALE_GRAY,
        title=f"{y} versus {x}",
        color_discrete_sequence=DISCRETE_COLORS,
    )
    return _style_figure(fig)


def observed_vs_predicted(df: pd.DataFrame) -> go.Figure:
    fig = px.scatter(
        df,
        x="distancia_horizontal_m",
        y="lmax_previsto_m",
        color="litologia",
        title="Observado versus previsto",
        color_discrete_sequence=DISCRETE_COLORS,
    )
    lim = max(df["distancia_horizontal_m"].max(), df["lmax_previsto_m"].max())
    fig.add_trace(
        go.Scatter(
            x=[0, lim],
            y=[0, lim],
            mode="lines",
            name="1:1",
            line={"color": VALE_GRAY, "dash": "dash", "width": 2},
        )
    )
    return _style_figure(fig)


def correlation_matrix(df: pd.DataFrame, columns: list[str]) -> go.Figure:
    corr = df[[c for c in columns if c in df]].corr(numeric_only=True)
    fig = px.imshow(
        corr,
        text_auto=True,
        title="Matriz de correlacao",
        color_continuous_scale=CONTINUOUS_COLORS,
        color_continuous_midpoint=0,
        zmin=-1,
        zmax=1,
    )
    return _style_figure(fig)


def sensitivity_tornado(rows: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        rows,
        x="impacto_m",
        y="parametro",
        orientation="h",
        title="Sensibilidade tipo tornado",
        color_discrete_sequence=[TURQUOISE],
    )
    return _style_figure(fig)
