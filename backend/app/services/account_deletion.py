from sqlalchemy.orm import Session

from app.db.models import (
    AcCoverageResult,
    AnalysisRun,
    CodeEmbeddingRecord,
    CodeMetrics,
    ContributorAnalysisSummary,
    ProfileActivityLog,
    RecruiterCandidate,
    RecruiterTask,
    RepositoryAnalysis,
    RepositoryContributor,
    RequirementCoverageRun,
    RequirementDocument,
    RefreshToken,
    SecurityFinding,
    SkillScore,
    SonarAnalysisSummary,
    SonarFileMeasure,
    SonarIssue,
    StoryCoverageSummary,
    TaskEmbeddingRecord,
    TechnicalTask,
    User,
    UserStory,
)


def _ids(rows) -> list[int]:
    return [row.id for row in rows]


def delete_user_account_data(db: Session, current_user: User) -> None:
    """Remove all user-owned and user-attributed data before deleting the user row."""
    user_id = current_user.id

    # Remove rows where this user is only an attribution target in someone else's analysis.
    db.query(CodeMetrics).filter(CodeMetrics.user_id == user_id).delete(synchronize_session=False)
    db.query(SecurityFinding).filter(SecurityFinding.user_id == user_id).delete(synchronize_session=False)
    db.query(SonarIssue).filter(SonarIssue.user_id == user_id).delete(synchronize_session=False)
    db.query(SonarFileMeasure).filter(SonarFileMeasure.user_id == user_id).delete(synchronize_session=False)
    db.query(SonarAnalysisSummary).filter(SonarAnalysisSummary.user_id == user_id).delete(synchronize_session=False)
    db.query(ContributorAnalysisSummary).filter(ContributorAnalysisSummary.user_id == user_id).delete(synchronize_session=False)
    db.query(SkillScore).filter(SkillScore.user_id == user_id).delete(synchronize_session=False)

    run_ids = _ids(db.query(AnalysisRun.id).filter(AnalysisRun.user_id == user_id).all())
    if run_ids:
        coverage_run_ids = _ids(
            db.query(RequirementCoverageRun.id)
            .filter(RequirementCoverageRun.analysis_run_id.in_(run_ids))
            .all()
        )
        if coverage_run_ids:
            db.query(AcCoverageResult).filter(AcCoverageResult.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(StoryCoverageSummary).filter(StoryCoverageSummary.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(CodeEmbeddingRecord).filter(CodeEmbeddingRecord.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(TaskEmbeddingRecord).filter(TaskEmbeddingRecord.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(RequirementCoverageRun).filter(RequirementCoverageRun.id.in_(coverage_run_ids)).delete(synchronize_session=False)

        db.query(RepositoryAnalysis).filter(RepositoryAnalysis.last_run_id.in_(run_ids)).update(
            {RepositoryAnalysis.last_run_id: None},
            synchronize_session=False,
        )
        db.query(RecruiterCandidate).filter(RecruiterCandidate.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(CodeMetrics).filter(CodeMetrics.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SecurityFinding).filter(SecurityFinding.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SonarIssue).filter(SonarIssue.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SonarFileMeasure).filter(SonarFileMeasure.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SonarAnalysisSummary).filter(SonarAnalysisSummary.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(ContributorAnalysisSummary).filter(ContributorAnalysisSummary.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SkillScore).filter(SkillScore.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(AnalysisRun).filter(AnalysisRun.id.in_(run_ids)).delete(synchronize_session=False)

    uploaded_doc_ids = _ids(
        db.query(RequirementDocument.id)
        .filter(RequirementDocument.uploaded_by_id == user_id)
        .all()
    )
    if uploaded_doc_ids:
        coverage_run_ids = _ids(
            db.query(RequirementCoverageRun.id)
            .filter(RequirementCoverageRun.document_id.in_(uploaded_doc_ids))
            .all()
        )
        if coverage_run_ids:
            db.query(AcCoverageResult).filter(AcCoverageResult.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(StoryCoverageSummary).filter(StoryCoverageSummary.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(CodeEmbeddingRecord).filter(CodeEmbeddingRecord.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(TaskEmbeddingRecord).filter(TaskEmbeddingRecord.coverage_run_id.in_(coverage_run_ids)).delete(synchronize_session=False)
            db.query(RequirementCoverageRun).filter(RequirementCoverageRun.id.in_(coverage_run_ids)).delete(synchronize_session=False)

        story_ids = _ids(
            db.query(UserStory.id)
            .filter(UserStory.document_id.in_(uploaded_doc_ids))
            .all()
        )
        if story_ids:
            task_ids = _ids(
                db.query(TechnicalTask.id)
                .filter(TechnicalTask.story_id.in_(story_ids))
                .all()
            )
            if task_ids:
                db.query(AcCoverageResult).filter(AcCoverageResult.task_id.in_(task_ids)).update(
                    {AcCoverageResult.task_id: None},
                    synchronize_session=False,
                )
                db.query(TaskEmbeddingRecord).filter(TaskEmbeddingRecord.task_id.in_(task_ids)).delete(synchronize_session=False)
                db.query(TechnicalTask).filter(TechnicalTask.id.in_(task_ids)).delete(synchronize_session=False)
            db.query(AcCoverageResult).filter(AcCoverageResult.story_id.in_(story_ids)).delete(synchronize_session=False)
            db.query(StoryCoverageSummary).filter(StoryCoverageSummary.story_id.in_(story_ids)).delete(synchronize_session=False)
            db.query(TaskEmbeddingRecord).filter(TaskEmbeddingRecord.story_id.in_(story_ids)).delete(synchronize_session=False)
            db.query(UserStory).filter(UserStory.id.in_(story_ids)).delete(synchronize_session=False)
        db.query(RequirementDocument).filter(RequirementDocument.id.in_(uploaded_doc_ids)).delete(synchronize_session=False)

    db.query(TechnicalTask).filter(TechnicalTask.assigned_to == user_id).update(
        {TechnicalTask.assigned_to: None},
        synchronize_session=False,
    )
    db.query(RepositoryAnalysis).filter(RepositoryAnalysis.user_id == user_id).delete(synchronize_session=False)
    db.query(RepositoryContributor).filter(RepositoryContributor.user_id == user_id).delete(synchronize_session=False)
    db.query(RefreshToken).filter(RefreshToken.user_id == user_id).delete(synchronize_session=False)

    task_ids = _ids(db.query(RecruiterTask.id).filter(RecruiterTask.recruiter_id == user_id).all())
    if task_ids:
        db.query(RecruiterCandidate).filter(RecruiterCandidate.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(RecruiterTask).filter(RecruiterTask.id.in_(task_ids)).delete(synchronize_session=False)

    db.query(ProfileActivityLog).filter(ProfileActivityLog.manager_id == user_id).delete(synchronize_session=False)
    db.query(ProfileActivityLog).filter(ProfileActivityLog.actor_id == user_id).update(
        {ProfileActivityLog.actor_id: None},
        synchronize_session=False,
    )
    db.query(ProfileActivityLog).filter(ProfileActivityLog.member_id == user_id).update(
        {ProfileActivityLog.member_id: None},
        synchronize_session=False,
    )

    db.delete(current_user)
