FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /uvx /bin/

ARG APP_VERSION=0.1.0
ARG GIT_SHA=

ENV PATH="/app/.venv/bin:${PATH}" \
    APP_VERSION="${APP_VERSION}" \
    GIT_SHA="${GIT_SHA}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

RUN useradd --create-home --home-dir /home/treasuri --shell /usr/sbin/nologin treasuri

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY migrations ./migrations
COPY main.py PRD.md ./

RUN chown -R treasuri:treasuri /app /home/treasuri

USER treasuri
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:5000/healthz', timeout=3).read()"

CMD ["python", "-m", "app.web"]
