FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PARSER_OCR_ENGINE=tesseract \
    OMP_THREAD_LIMIT=1 \
    INVOICE_PARSER_TEMPLATE_DIR=/app/templates

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
       tesseract-ocr-ukr tesseract-ocr-rus fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 gmed \
    && useradd --uid 10001 --gid gmed --no-create-home gmed

WORKDIR /app
# Build from the repository root. Reuse the existing extraction implementation
# without copying clinical parsing, database access, or the queue worker.
COPY services/clinical-document-parser/app/__init__.py \
     services/clinical-document-parser/app/extraction.py \
     services/clinical-document-parser/app/lab_grid.py \
     services/clinical-document-parser/app/paddle_runtime.py ./app/
COPY services/invoice-parser/pyproject.toml ./
COPY services/invoice-parser/invoice_parser ./invoice_parser
COPY services/invoice-parser/templates ./templates
RUN pip install --no-cache-dir .

# Preserve non-root runtime access even when the build context has a strict umask.
RUN chmod -R a+rX /app

USER 10001:10001
EXPOSE 8091
CMD ["uvicorn", "invoice_parser.api:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "1", "--no-access-log"]
