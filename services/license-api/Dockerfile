FROM python:3.12-slim

WORKDIR /app
ENV LICENSE_API_HOST=0.0.0.0
ENV LICENSE_API_PORT=8000

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app
COPY main.py /app/main.py

VOLUME [ "/data" ]

CMD ["python", "main.py"]
