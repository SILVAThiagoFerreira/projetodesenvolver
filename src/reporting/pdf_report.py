from pathlib import Path


def _write_minimal_pdf(output: Path) -> None:
    text = "Relatorio Flyrock\\nFerramenta de apoio tecnico. Nao substitui responsavel tecnico habilitado."
    stream = f"BT /F1 12 Tf 72 760 Td ({text}) Tj ET"
    objects = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
        "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        f"5 0 obj << /Length {len(stream.encode('latin-1'))} >> stream\n{stream}\nendstream endobj",
    ]
    pdf = "%PDF-1.4\n"
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf.encode("latin-1")))
        pdf += obj + "\n"
    xref = len(pdf.encode("latin-1"))
    pdf += f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n"
    pdf += "".join(f"{off:010d} 00000 n \n" for off in offsets[1:])
    pdf += f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    output.write_bytes(pdf.encode("latin-1"))


def render_pdf_report(html_path: str | Path, output_path: str | Path = "reports/outputs/relatorio_flyrock.pdf") -> Path | None:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        from weasyprint import HTML
        HTML(filename=str(html_path)).write_pdf(str(output))
        return output
    except Exception:
        _write_minimal_pdf(output)
        return output
