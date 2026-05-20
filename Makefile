.PHONY: test lint typecheck run
test:
	pytest
lint:
	ruff check .
typecheck:
	mypy src
run:
	streamlit run app/streamlit_app.py
