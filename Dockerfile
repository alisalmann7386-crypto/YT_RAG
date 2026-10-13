FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/app/data PORT=8000
WORKDIR /app
COPY requirements.txt pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir -e .
# Build with --build-arg ENABLE_SEMANTIC=true for optional hybrid retrieval.
ARG ENABLE_SEMANTIC=false
RUN if [ "$ENABLE_SEMANTIC" = "true" ]; then \
      pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
      pip install --no-cache-dir -e '.[semantic]'; \
    fi
RUN useradd --create-home --uid 10001 studyroom && mkdir -p /app/data && chown -R studyroom:studyroom /app
USER studyroom
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4)" || exit 1
CMD ["python", "-m", "app.bootstrap"]
