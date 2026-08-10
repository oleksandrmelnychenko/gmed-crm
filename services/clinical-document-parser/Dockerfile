FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata \
    FLAGS_use_mkldnn=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
       tesseract-ocr-rus tesseract-ocr-ukr \
       fonts-dejavu-core \
       libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY rules ./rules
RUN pip install --no-cache-dir \
    --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    ".[paddle]"

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=1 \
    PADDLE_PDX_MODEL_SOURCE=bos

# Fail the image build if the exact production pipeline or its model cache is
# unavailable. Then move the preloaded cache to the unprivileged runtime user,
# so runtime OCR never needs root or outbound internet.
RUN python -c "from app.extraction import _get_paddle_ocr; _get_paddle_ocr()"
RUN test -d /root/.paddlex \
    && addgroup --system gmed \
    && adduser --system --ingroup gmed --home /home/gmed gmed \
    && mv /root/.paddlex /home/gmed/.paddlex \
    && chown -R gmed:gmed /home/gmed/.paddlex

USER gmed:gmed

EXPOSE 8090
CMD ["python", "-m", "app.worker"]
