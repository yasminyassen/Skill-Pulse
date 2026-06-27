import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from app.services.security.pipeline import _is_generated_security_artifact


def test_generated_security_artifacts_are_filtered():
    assert _is_generated_security_artifact(
        "sonar-project.properties",
        generated_artifacts=["sonar-project.properties"],
    )
    assert _is_generated_security_artifact(".scannerwork/report-task.txt")
    assert _is_generated_security_artifact("gitleaks-report.json")


def test_repository_files_are_not_filtered_as_generated_artifacts():
    assert not _is_generated_security_artifact("sonar-project.properties")
    assert not _is_generated_security_artifact("requirements.txt")
    assert not _is_generated_security_artifact("src/sonar-project.properties.py")
    assert not _is_generated_security_artifact("config/gitleaks-report-template.json")
