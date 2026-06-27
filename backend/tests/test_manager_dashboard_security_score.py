import os
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.manager_dashboard import _contributor_rows, _repository_metric_cards, _team_performance
from app.db.database import Base
from app.db.models import AnalysisRun, ContributorAnalysisSummary, Repository, SkillScore, SonarAnalysisSummary, SonarIssue, User, UserRole


def _db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            User.__table__,
            Repository.__table__,
            AnalysisRun.__table__,
            SkillScore.__table__,
            SonarAnalysisSummary.__table__,
            ContributorAnalysisSummary.__table__,
            SonarIssue.__table__,
        ],
    )
    return sessionmaker(bind=engine)()


def _user(db, user_id: int, role: UserRole) -> User:
    user = User(
        id=user_id,
        github_id=f"gh-{user_id}",
        username=f"user{user_id}",
        full_name=f"User {user_id}",
        work_email=f"user{user_id}@example.com",
        hashed_password="hashed",
        role=role,
    )
    db.add(user)
    return user


def test_manager_dashboard_security_card_uses_team_security_health_score_source():
    db = _db_session()
    try:
        manager = _user(db, 1, UserRole.manager)
        developer_one = _user(db, 2, UserRole.developer)
        developer_two = _user(db, 3, UserRole.developer)
        repo = Repository(
            github_repo_id="repo-1",
            name="repo",
            full_name="acme/repo",
            url="https://example.test/acme/repo",
        )
        db.add(repo)
        db.flush()

        repository_run = AnalysisRun(
            repository_id=repo.id,
            user_id=manager.id,
            branch="main",
            analysis_scope="repository",
            status="completed",
            completed_at=datetime(2026, 6, 20, tzinfo=timezone.utc),
            ai_insights={"security_report": {"security_score": 12}},
        )
        team_security_run = AnalysisRun(
            repository_id=repo.id,
            user_id=manager.id,
            branch="main",
            analysis_scope="team_contributions",
            status="completed",
            completed_at=datetime(2026, 6, 21, tzinfo=timezone.utc),
        )
        db.add_all([repository_run, team_security_run])
        db.flush()

        db.add_all(
            [
                SkillScore(
                    analysis_run_id=repository_run.id,
                    user_id=manager.id,
                    overall_score=70,
                    security_awareness_score=12,
                ),
                SkillScore(
                    analysis_run_id=team_security_run.id,
                    user_id=developer_one.id,
                    security_awareness_score=80,
                ),
                SkillScore(
                    analysis_run_id=team_security_run.id,
                    user_id=developer_two.id,
                    security_awareness_score=90,
                ),
            ]
        )
        db.commit()

        cards = _repository_metric_cards(db, repository_run, manager.id)
        security_card = next(card for card in cards if card.key == "security_score")

        assert security_card.value == 85
    finally:
        db.close()


def test_manager_contributor_rows_use_attributed_sonar_issue_counts():
    db = _db_session()
    try:
        manager = _user(db, 1, UserRole.manager)
        developer_one = _user(db, 2, UserRole.developer)
        developer_two = _user(db, 3, UserRole.developer)
        repo = Repository(
            github_repo_id="repo-2",
            name="repo",
            full_name="acme/repo",
            url="https://example.test/acme/repo",
        )
        db.add(repo)
        db.flush()

        team_run = AnalysisRun(
            repository_id=repo.id,
            user_id=manager.id,
            branch="main",
            analysis_scope="team_contributions",
            status="completed",
            completed_at=datetime(2026, 6, 21, tzinfo=timezone.utc),
        )
        db.add(team_run)
        db.flush()

        db.add_all([
            ContributorAnalysisSummary(
                analysis_run_id=team_run.id,
                repository_id=repo.id,
                user_id=developer_one.id,
                skill_score=82.5,
                sonar_health_score=75,
                security_score=100,
                bugs=0,
                code_smells=5,
                coverage=100,
                measures={
                    "bugs": "0",
                    "code_smells": "5",
                    "coverage": "100",
                    "duplicated_lines_density": "0",
                    "complexity": "0",
                    "cognitive_complexity": "0",
                },
                raw_payload={"coverage": {"available": True}},
            ),
            ContributorAnalysisSummary(
                analysis_run_id=team_run.id,
                repository_id=repo.id,
                user_id=developer_two.id,
                skill_score=82.5,
                sonar_health_score=75,
                security_score=100,
                bugs=0,
                code_smells=5,
                coverage=100,
                measures={
                    "bugs": "0",
                    "code_smells": "5",
                    "coverage": "100",
                    "duplicated_lines_density": "0",
                    "complexity": "0",
                    "cognitive_complexity": "0",
                },
                raw_payload={"coverage": {"available": True}},
            ),
        ])
        for index in range(5):
            db.add(SonarIssue(
                analysis_run_id=team_run.id,
                user_id=developer_one.id,
                issue_key=f"SMELL-{index}",
                file_path="app.py",
                line=index + 1,
                type="CODE_SMELL",
                severity="MAJOR",
                status="OPEN",
            ))
        db.commit()

        rows = [
            (summary, team_run, repo, developer)
            for summary, developer in (
                (db.query(ContributorAnalysisSummary).filter_by(user_id=developer_one.id).one(), developer_one),
                (db.query(ContributorAnalysisSummary).filter_by(user_id=developer_two.id).one(), developer_two),
            )
        ]

        contributors = {row.id: row for row in _contributor_rows(db, rows)}

        assert contributors[developer_one.id].code_smells == 5
        assert contributors[developer_two.id].code_smells == 0
        assert contributors[developer_one.id].health_score == 97.5
        assert contributors[developer_two.id].health_score == 100
        assert contributors[developer_one.id].skill_score == 98.25
        assert contributors[developer_two.id].skill_score == 100

        team_performance = _team_performance(list(contributors.values()))
        assert team_performance.best_contributor.id == developer_two.id
        assert team_performance.needs_support_contributor.id == developer_one.id
    finally:
        db.close()
