"""Leitura do armazenamento de objetos. Espelha o StorageAdapter da API."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol


class Storage(Protocol):
    def get(self, key: str) -> bytes: ...
    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None: ...


class FsStorage:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root)):
            raise ValueError("Chave de armazenamento invalida (path traversal).")
        return p

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


class S3Storage:
    def __init__(self, endpoint: str, region: str, bucket: str, access_key: str, secret_key: str) -> None:
        import boto3

        self.bucket = bucket
        kwargs = {"region_name": region, "aws_access_key_id": access_key, "aws_secret_access_key": secret_key}
        if endpoint:
            kwargs["endpoint_url"] = endpoint
        self.client = boto3.client("s3", **kwargs)

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)


def build_storage(cfg) -> Storage:
    if cfg.storage_driver == "s3":
        if not cfg.s3_bucket:
            raise RuntimeError("STORAGE_DRIVER=s3 exige S3_BUCKET. Veja .env.example.")
        return S3Storage(cfg.s3_endpoint, cfg.s3_region, cfg.s3_bucket, cfg.s3_access_key, cfg.s3_secret_key)
    root = cfg.storage_fs_root
    if not os.path.isabs(root):
        root = os.path.abspath(root)
    return FsStorage(root)
