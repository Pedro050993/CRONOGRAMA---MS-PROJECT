# Worker de processamento documental — Python 3.11
FROM python:3.11-slim-bookworm

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/src

# tesseract-ocr e opcional: sem ele o adaptador de OCR fica indisponivel e as
# regioes sem texto viram pendencia explicita, que e o comportamento pretendido.
ARG WITH_OCR=false
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 \
      $(if [ "$WITH_OCR" = "true" ]; then echo tesseract-ocr tesseract-ocr-por tesseract-ocr-eng; fi) \
    && rm -rf /var/lib/apt/lists/*

COPY services/docproc/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$WITH_OCR" = "true" ]; then pip install --no-cache-dir pytesseract opencv-python-headless; fi

COPY services/docproc/src ./src
COPY services/docproc/pyproject.toml ./

RUN useradd --create-home --shell /usr/sbin/nologin app && chown -R app:app /app
USER app

CMD ["python", "-m", "docproc.worker"]
