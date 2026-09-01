"""Shared logging configuration for provision API and SSH bridge."""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone

_RESERVED = frozenset(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()
) | frozenset({"message", "asctime"})

_STRUCTURED_KEYS = frozenset({"event", "student_id", "pod_id", "detail"})


class _ServiceFilter(logging.Filter):
    def __init__(self, service: str):
        super().__init__()
        self.service = service

    def filter(self, record: logging.LogRecord) -> bool:
        record.service = self.service
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "service": getattr(record, "service", ""),
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            if key in _STRUCTURED_KEYS:
                payload[key] = value
        return json.dumps(payload, default=str)


def configure_logging(
    service: str,
    level: str = "INFO",
    log_format: str | None = None,
) -> None:
    fmt = (log_format or os.getenv("LOG_FORMAT", "text")).lower()
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    handler = logging.StreamHandler(sys.stdout)
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
        )
    handler.addFilter(_ServiceFilter(service))
    root.addHandler(handler)