import logging

from ai_services.learning.resource_store import load_resources, build_resource_index, index_exists

logger = logging.getLogger(__name__)


def seed_learning_resources() -> None:
    if index_exists():
        logger.info("[LEARNING] Resource index already exists, skipping seeding")
        return

    resources = load_resources()
    count = build_resource_index(resources)
    if count == 0:
        logger.warning("[LEARNING] No learning resources indexed")
    else:
        logger.info("[LEARNING] Learning resources indexed: %s", count)
