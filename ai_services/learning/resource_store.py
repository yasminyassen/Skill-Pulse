import json
import logging
from pathlib import Path

import faiss
import numpy as np

from ai_services.rag.rag_store import embed_chunks

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "resources.json"
INDEX_DIR = BASE_DIR / "faiss_index"
INDEX_DIR.mkdir(parents=True, exist_ok=True)

RESOURCE_INDEX_ID = "skillpulse_learning_resources_v1"
INDEX_PATH = INDEX_DIR / f"{RESOURCE_INDEX_ID}.faiss"
META_PATH = INDEX_DIR / f"{RESOURCE_INDEX_ID}.meta.json"


def load_resources() -> list[dict]:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Learning resources file not found: {DATA_PATH}")
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Learning resources JSON must be a list")
    return data


def _resource_text(resource: dict) -> str:
    tags = resource.get("tags") or {}
    tag_parts = []
    for key in ("skills", "concepts", "security_domains", "frameworks", "issue_categories"):
        values = tags.get(key) or []
        if isinstance(values, list):
            tag_parts.extend(values)
    topics = resource.get("topics") or []
    pieces = [
        resource.get("title", ""),
        resource.get("description", ""),
        " ".join(topics),
        " ".join(tag_parts),
    ]
    return " ".join(p for p in pieces if p).strip()


def index_exists() -> bool:
    return INDEX_PATH.exists() and META_PATH.exists()


def build_resource_index(resources: list[dict]) -> int:
    texts = [_resource_text(r) for r in resources]
    texts = [t for t in texts if t]
    if not texts:
        logger.warning("[LEARNING] No resource texts to embed")
        return 0

    embeddings = embed_chunks(texts).astype("float32")
    faiss.normalize_L2(embeddings)

    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)

    faiss.write_index(index, str(INDEX_PATH))

    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump({"doc_id": RESOURCE_INDEX_ID, "resources": resources}, f, ensure_ascii=True)

    logger.info("[LEARNING] Resource index built: %s entries", len(texts))
    return len(texts)


def retrieve_resources(query: str, top_k: int = 8) -> list[dict]:
    if not index_exists():
        raise FileNotFoundError("Learning resource index not found")

    if not query:
        return []

    with open(META_PATH, "r", encoding="utf-8") as f:
        meta = json.load(f)
    resources = meta.get("resources", [])

    index = faiss.read_index(str(INDEX_PATH))
    q_vec = embed_chunks([query]).astype("float32")
    faiss.normalize_L2(q_vec)

    k = min(top_k, len(resources))
    scores, indices = index.search(q_vec, k)

    results: list[dict] = []
    for rank, (idx, score) in enumerate(zip(indices[0], scores[0]), start=1):
        if idx == -1 or idx >= len(resources):
            continue
        results.append({
            "resource": resources[idx],
            "score": float(score),
            "rank": rank,
        })
    return results
