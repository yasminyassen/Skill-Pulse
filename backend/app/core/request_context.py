from __future__ import annotations

import hashlib
import logging
import time
import uuid
from collections import defaultdict
from contextvars import ContextVar
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Awaitable, Callable, TypeVar

logger = logging.getLogger("app.instrumentation")

T = TypeVar("T")


@dataclass
class RequestMetrics:
    request_id: str
    method: str
    path: str
    query: str
    referer: str | None
    started_at: float = field(default_factory=time.perf_counter)
    cache: dict[tuple[Any, ...], Any] = field(default_factory=dict)
    counters: defaultdict[str, int] = field(default_factory=lambda: defaultdict(int))


_current_metrics: ContextVar[RequestMetrics | None] = ContextVar("request_metrics", default=None)
_recent_requests: dict[str, float] = {}
_request_totals: defaultdict[str, int] = defaultdict(int)
_recent_lock = Lock()
_DUPLICATE_WINDOW_SECONDS = 2.0


def begin_request(method: str, path: str, query: str, referer: str | None, user_key: str | None) -> tuple[RequestMetrics, bool]:
    metrics = RequestMetrics(
        request_id=uuid.uuid4().hex,
        method=method,
        path=path,
        query=query,
        referer=referer,
    )
    _current_metrics.set(metrics)

    source = referer or "direct"
    request_count_key = f"{method} {path} <- {source}"
    metrics.counters["request_count_for_page"] = _increment_request_total(request_count_key)

    duplicate_key = _request_signature(method, path, query, user_key)
    duplicate = _mark_and_check_duplicate(duplicate_key)
    if duplicate:
        metrics.counters["duplicate_request_detected"] += 1
    return metrics, duplicate


def end_request() -> None:
    _current_metrics.set(None)


def current_metrics() -> RequestMetrics | None:
    return _current_metrics.get()


def increment_query_count() -> None:
    metrics = current_metrics()
    if metrics is not None:
        metrics.counters["db_queries"] += 1


def record_external_call(service: str, count: int = 1) -> None:
    metrics = current_metrics()
    if metrics is not None:
        metrics.counters["external_api_calls"] += count
        metrics.counters[f"external_api_calls.{service}"] += count


def cache_get(key: tuple[Any, ...]) -> Any:
    metrics = current_metrics()
    if metrics is None:
        return None
    if key in metrics.cache:
        metrics.counters["request_cache_hits"] += 1
        return metrics.cache[key]
    metrics.counters["request_cache_misses"] += 1
    return None


def cache_set(key: tuple[Any, ...], value: T) -> T:
    metrics = current_metrics()
    if metrics is not None:
        metrics.cache[key] = value
    return value


async def get_or_set_async(key: tuple[Any, ...], factory: Callable[[], Awaitable[T]]) -> T:
    cached = cache_get(key)
    if cached is not None:
        return cached
    value = await factory()
    return cache_set(key, value)


def get_or_set_sync(key: tuple[Any, ...], factory: Callable[[], T]) -> T:
    cached = cache_get(key)
    if cached is not None:
        return cached
    value = factory()
    return cache_set(key, value)


def log_request_metrics(status_code: int, duplicate: bool) -> None:
    metrics = current_metrics()
    if metrics is None:
        return
    elapsed_ms = (time.perf_counter() - metrics.started_at) * 1000
    cache_hits = metrics.counters.get("request_cache_hits", 0)
    cache_misses = metrics.counters.get("request_cache_misses", 0)
    cache_total = cache_hits + cache_misses
    cache_hit_rate = (cache_hits / cache_total) if cache_total else 0.0
    logger.info(
        "request_metrics request_id=%s method=%s path=%s status=%s duration_ms=%.2f "
        "db_queries=%s external_api_calls=%s github_calls=%s sonarqube_calls=%s "
        "llm_calls=%s cache_hits=%s cache_misses=%s cache_hit_rate=%.2f "
        "duplicate_request=%s page_request_count=%s referer=%s",
        metrics.request_id,
        metrics.method,
        metrics.path,
        status_code,
        elapsed_ms,
        metrics.counters.get("db_queries", 0),
        metrics.counters.get("external_api_calls", 0),
        metrics.counters.get("external_api_calls.github", 0),
        metrics.counters.get("external_api_calls.sonarqube", 0),
        metrics.counters.get("external_api_calls.llm", 0),
        cache_hits,
        cache_misses,
        cache_hit_rate,
        duplicate,
        metrics.counters.get("request_count_for_page", 0),
        metrics.referer or "",
    )


def _increment_request_total(key: str) -> int:
    with _recent_lock:
        _request_totals[key] += 1
        return _request_totals[key]


def _request_signature(method: str, path: str, query: str, user_key: str | None) -> str:
    raw = f"{method}|{path}|{query}|{user_key or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _mark_and_check_duplicate(key: str) -> bool:
    now = time.monotonic()
    with _recent_lock:
        stale = [item for item, seen_at in _recent_requests.items() if now - seen_at > _DUPLICATE_WINDOW_SECONDS]
        for item in stale:
            _recent_requests.pop(item, None)
        duplicate = key in _recent_requests
        _recent_requests[key] = now
        return duplicate
