FROM python:3.12-slim

ARG DEBIAN_SECURITY_REFRESH=local
ARG GMED_RUNTIME_UID=100
ARG GMED_RUNTIME_GID=101

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata \
    FLAGS_use_mkldnn=0

RUN echo "security-refresh=${DEBIAN_SECURITY_REFRESH}" >/dev/null \
    && apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
       tesseract-ocr-rus tesseract-ocr-ukr \
       fonts-dejavu-core \
       libgl1 libglib2.0-0 libgomp1 \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' util-linux)" ge '2.41.5-0+deb13u1' \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' openssl)" ge '3.5.7-1~deb13u2' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY rules ./rules
RUN pip install --no-cache-dir \
    --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    ".[paddle,translation]"

RUN --mount=type=bind,target=/build-input,readonly \
    if [ -f /build-input/translation-model.argosmodel ]; then \
      python -m app.install_translation_model --archive /build-input/translation-model.argosmodel; \
    else \
      python -m app.install_translation_model; \
    fi \
    && python -c "from app.translation_runtime import translate_payload; from pathlib import Path; result = translate_payload({'text': 'No evidence of pneumonia.', 'candidates': {}}, Path('models/translate-en_de-1_3')); assert result['text']"

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=1 \
    PADDLE_PDX_MODEL_SOURCE=bos

# Fail the image build if the exact production pipeline or its model cache is
# unavailable. Then move the preloaded cache to the unprivileged runtime user,
# so runtime OCR never needs root or outbound internet.
RUN python -c "from app.extraction import _get_paddle_ocr; _get_paddle_ocr()"
RUN test -d /root/.paddlex \
    && addgroup --system --gid "${GMED_RUNTIME_GID}" gmed \
    && adduser --system --uid "${GMED_RUNTIME_UID}" --ingroup gmed --home /home/gmed gmed \
    && mv /root/.paddlex /home/gmed/.paddlex \
    && chown -R gmed:gmed /home/gmed/.paddlex

USER gmed:gmed

EXPOSE 8090
CMD ["python", "-m", "app.worker"]
