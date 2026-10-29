FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY python_backend/requirements.txt python_backend/constraints.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY python_backend/app ./app
COPY python_backend/migrations ./migrations
COPY python_backend/tools/migrate.py python_backend/tools/ops.py ./tools/
COPY python_backend/main.py python_backend/alembic.ini ./
RUN useradd --create-home app && chown -R app:app /app
USER app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
