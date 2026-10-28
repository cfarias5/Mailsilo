FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pst-utils \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir .

RUN mkdir -p /app/storage/attachments

COPY . .

EXPOSE 8765

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765", "--timeout-keep-alive", "300"]
