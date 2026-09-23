# Offline machine-translation models (build stage only). Pinned OPUS-MT
# revisions are converted to CTranslate2 int8; torch/transformers never reach
# the runtime image. See MT_MODELS_NOTICE for licenses and attribution.
FROM python:3.12-slim AS mt-models

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_DISABLE_TELEMETRY=1

RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.0 \
    && pip install --no-cache-dir \
       transformers==4.57.6 sentencepiece==0.2.2 sacremoses==0.2.0 \
       huggingface_hub==0.36.2 ctranslate2==4.8.2

WORKDIR /build
COPY app/mt_models.py app/build_mt_models.py ./app/
RUN python -m app.build_mt_models --output /out \
    && rm -rf /root/.cache/huggingface
COPY MT_MODELS_NOTICE /out/NOTICE

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

# Offline translation service (second compose service, same image):
#   python -m uvicorn app.mt_api:app --host 0.0.0.0 --port 8092
# Fail the build if a converted model is missing or numbers are not preserved.
COPY --from=mt-models /out /app/mt-models
RUN python -c "from pathlib import Path; from app.mt_engine import MTEngine, CTranslate2Backend, MODELS; backend = CTranslate2Backend(Path('/app/mt-models'), max_loaded=1, threads=2); missing = [key for key in MODELS if not backend.available(key)]; assert not missing, missing; result = MTEngine(backend).translate('Kontrolle am 18.03.2026 bei Anna Beispiel.', 'de', 'ru', ['Anna Beispiel']); assert '18.03.2026' in result.text and 'Anna Beispiel' in result.text, result"

# Build contexts can come from restrictive workstation/deployment umasks.
# Application code and bundled public models must be readable by the worker.
RUN chmod -R a+rX /app

USER gmed:gmed

EXPOSE 8090
CMD ["python", "-m", "app.worker"]
