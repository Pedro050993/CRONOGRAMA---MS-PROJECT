"""Configuracao do worker, lida do ambiente. Sem valor padrao para segredo."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _req(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"Variavel de ambiente obrigatoria ausente: {name}. Veja .env.example.")
    return v


@dataclass(frozen=True)
class Config:
    database_url: str
    storage_driver: str
    storage_fs_root: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str
    poll_interval: float
    concurrency: int
    ocr_provider: str
    ocr_languages: str
    ocr_endpoint: str
    ocr_api_key: str
    llm_provider: str
    llm_endpoint: str
    llm_api_key: str
    llm_model: str

    @staticmethod
    def from_env() -> "Config":
        return Config(
            database_url=_req("DATABASE_URL"),
            storage_driver=os.environ.get("STORAGE_DRIVER", "fs"),
            storage_fs_root=os.environ.get("STORAGE_FS_ROOT", "./storage-data"),
            s3_endpoint=os.environ.get("S3_ENDPOINT", ""),
            s3_region=os.environ.get("S3_REGION", "us-east-1"),
            s3_bucket=os.environ.get("S3_BUCKET", ""),
            s3_access_key=os.environ.get("S3_ACCESS_KEY_ID", ""),
            s3_secret_key=os.environ.get("S3_SECRET_ACCESS_KEY", ""),
            poll_interval=float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "2")),
            concurrency=int(os.environ.get("WORKER_CONCURRENCY", "1")),
            ocr_provider=os.environ.get("OCR_PROVIDER", "none"),
            ocr_languages=os.environ.get("OCR_LANGUAGES", "por+eng"),
            ocr_endpoint=os.environ.get("OCR_ENDPOINT", ""),
            ocr_api_key=os.environ.get("OCR_API_KEY", ""),
            llm_provider=os.environ.get("LLM_PROVIDER", "none"),
            llm_endpoint=os.environ.get("LLM_ENDPOINT", ""),
            llm_api_key=os.environ.get("LLM_API_KEY", ""),
            llm_model=os.environ.get("LLM_MODEL", ""),
        )
