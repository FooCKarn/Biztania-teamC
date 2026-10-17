# Pipeline service for uploaded engagements (auditconcierge/server.py).
# Free option: Render web service (Docker, region Singapore); see docs/deploy-pipeline.md.
FROM python:3.12-slim-bookworm

# Tesseract with Thai + English for scanned documents. CI pins 5.3.4 (ubuntu 24.04); bookworm
# ships 5.3.0, close enough for real documents (the sample scan test is pinned in CI, not here).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-tha tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY auditconcierge ./auditconcierge

# Unprivileged user; nothing is written outside the per-job temp folder, which is deleted after each job.
RUN useradd --create-home --uid 10001 pipeline
USER pipeline
ENV PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "-m", "auditconcierge.server"]
