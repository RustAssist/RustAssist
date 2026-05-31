FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml /app/pyproject.toml
COPY app /app/app
RUN pip install --no-cache-dir .

VOLUME [ "/app/data" ]
ENV LICENSE_DATABASE_URL=sqlite:////app/data/license-api.sqlite

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
