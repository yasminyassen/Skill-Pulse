from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Float, JSON, Enum, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base
from datetime import datetime, timedelta
from sqlalchemy.dialects import postgresql
import enum

# Roles
class UserRole(str, enum.Enum):
    developer = "developer"
    manager = "manager"
    recruiter = "recruiter"

class DeveloperSpecialization(str, enum.Enum):
    backend = "backend"
    frontend = "frontend"
    qa = "qa"
class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    github_id = Column(String, unique=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False) 
    full_name = Column(String, nullable=False) 
    work_email = Column(String, unique=True, index=True, nullable=False) 
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=True, default=None)
    specialization = Column(Enum(DeveloperSpecialization), nullable=True, default=None)
    avatar_url = Column(String, nullable=True)
    github_access_token = Column(String, nullable=True)
    github_refresh_token = Column(String, nullable=True)
    github_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    github_refresh_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    organization = Column(String, nullable=True)
    job_title    = Column(String, nullable=True)
    
    
    department              = Column(String,  nullable=True)
    hiring_focus            = Column(String,  nullable=True)

    security_score_visible  = Column(Boolean, nullable=True, default=True)
    high_priority_threshold = Column(Integer, nullable=True, default=75)
    weight_code_quality     = Column(Integer, nullable=True, default=40)
    weight_security         = Column(Integer, nullable=True, default=30)
    weight_git_activity     = Column(Integer, nullable=True, default=20)
    weight_requirements     = Column(Integer, nullable=True, default=10)
   
    
    analysis_runs = relationship("AnalysisRun", back_populates="user", cascade="all, delete-orphan")

class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    github_repo_id = Column(String, unique=True, index=True)
    name = Column(String)
    full_name = Column(String)
    url = Column(String)
    is_private = Column(Boolean, default=False)
    connected_at = Column(DateTime(timezone=True), server_default=func.now())
    
    analysis_runs = relationship("AnalysisRun", back_populates="repository")
    repository_analyses = relationship("RepositoryAnalysis", back_populates="repository")

class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    branch = Column(String, default="main")
    commit_sha = Column(String, nullable=True)   
    analysis_scope = Column(String, default="repository")
    contributor_login = Column(String, nullable=True)
    status = Column(String, default="pending")
    triggered_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    repository = relationship("Repository", back_populates="analysis_runs")
    code_metrics = relationship("CodeMetrics", back_populates="analysis_run", cascade="all, delete-orphan")
    security_findings = relationship("SecurityFinding", back_populates="analysis_run", cascade="all, delete-orphan")
    skill_scores = relationship("SkillScore", back_populates="analysis_run", cascade="all, delete-orphan")
    user = relationship("User", back_populates="analysis_runs")
    ai_insights = Column(JSON, nullable=True)
    recruiter_candidate = relationship("RecruiterCandidate", back_populates="analysis_run", uselist=False)


class RepositoryAnalysis(Base):
    __tablename__ = "repository_analyses"

    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    latest_commit_sha = Column(String, nullable=True)
    analysis_version = Column(String, nullable=False)
    analyzed_at = Column(DateTime(timezone=True), nullable=True)
    analysis_status = Column(String, nullable=False, default="pending")
    results_path = Column(String, nullable=True)
    force_reanalyzed = Column(Boolean, default=False)
    last_run_id = Column(Integer, ForeignKey("analysis_runs.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    repository = relationship("Repository", back_populates="repository_analyses")
    user = relationship("User")
    last_run = relationship("AnalysisRun")


class RecruiterCandidate(Base):
    __tablename__ = "recruiter_candidates"

    id = Column(Integer, primary_key=True, index=True)
    analysis_run_id = Column(Integer, ForeignKey("analysis_runs.id"), unique=True, nullable=False)
    candidate_name = Column(String, nullable=False)
    github_login = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    analysis_run = relationship("AnalysisRun", back_populates="recruiter_candidate")
class CodeMetrics(Base):
    __tablename__ = "code_metrics"

    id = Column(Integer, primary_key=True, index=True)
    analysis_run_id = Column(Integer, ForeignKey("analysis_runs.id"))
    file_path = Column(String)
    cyclomatic_complexity = Column(Float, nullable=True)
    lines_of_code = Column(Integer, nullable=True)
    duplication_score = Column(Float, nullable=True)
    maintainability_index = Column(Float, nullable=True)
    raw_metrics = Column(JSON, nullable=True)

    analysis_run = relationship("AnalysisRun", back_populates="code_metrics")

class SecurityFinding(Base):
    __tablename__ = "security_findings"

    id = Column(Integer, primary_key=True, index=True)
    analysis_run_id = Column(Integer, ForeignKey("analysis_runs.id"))
    tool = Column(String)
    rule = Column(String)
    cwe = Column(String)
    file_path = Column(String)
    severity = Column(String)
    description = Column(Text)
    line_number = Column(Integer, nullable=True)
    owasp_category = Column(String)

    analysis_run = relationship("AnalysisRun", back_populates="security_findings")

class SkillScore(Base):
    __tablename__ = "skill_scores"

    id = Column(Integer, primary_key=True, index=True)
    analysis_run_id = Column(Integer, ForeignKey("analysis_runs.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    code_quality_score = Column(Float)
    maintainability_score = Column(Float)
    architecture_score = Column(Float, nullable=True)
    security_awareness_score = Column(Float)
    problem_solving_score = Column(Float)
    overall_score = Column(Float)
    

    analysis_run = relationship("AnalysisRun", back_populates="skill_scores")
    user = relationship("User")

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    token = Column(String, unique=True, index=True)  
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class DocumentType(str, enum.Enum):
    pdf = "pdf"
    markdown = "markdown"
    excel = "excel"


class DocumentStatus(str, enum.Enum):
    processing = "processing"
    extracted = "extracted"
    failed = "failed"


class StoryPriority(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class AssignmentStatus(str, enum.Enum):
    assigned = "assigned"
    in_progress = "in_progress"
    completed = "completed"
    blocked = "blocked"


class RequirementDocument(Base):
    __tablename__ = "requirement_documents"

    id = Column(Integer, primary_key=True, index=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    repository_id = Column(Integer, ForeignKey("repositories.id"), nullable=True)
    title = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    file_type = Column(Enum(DocumentType), nullable=False)
    status = Column(Enum(DocumentStatus), default=DocumentStatus.processing, nullable=False)
    error_message = Column(Text, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)

    uploader = relationship("User", foreign_keys=[uploaded_by_id], backref="uploaded_documents")
    repository = relationship("Repository", foreign_keys=[repository_id], backref="requirement_documents")
    user_stories = relationship("UserStory", back_populates="document", cascade="all, delete-orphan")




class UserStory(Base):
    __tablename__ = "user_stories"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("requirement_documents.id", ondelete="CASCADE"), nullable=False)
    story_code = Column(String, nullable=False)
    title = Column(String, nullable=False)
    role = Column(String, nullable=False)
    feature = Column(String, nullable=False)
    benefit = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    acceptance_criteria = Column(JSON, nullable=False, default=[])
    priority = Column(String, nullable=False, default="medium")
    tags = Column(JSON, nullable=False, default=[])

    technical_tasks = relationship("TechnicalTask", back_populates="story", cascade="all, delete-orphan")
    document = relationship("RequirementDocument", back_populates="user_stories")


class TechnicalTask(Base):
    __tablename__ = "technical_tasks"

    id = Column(Integer, primary_key=True, index=True)
    story_id = Column(Integer, ForeignKey("user_stories.id", ondelete="CASCADE"), nullable=False)
    description = Column(Text, nullable=False)
    type = Column(postgresql.ENUM('backend', 'frontend', 'qa', name='developerspecialization', create_type=False), nullable=False)
    status = Column(Enum(TaskStatus), nullable=False, default=TaskStatus.todo)
    assigned_to = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    ac_ids = Column(JSON, nullable=True, default=[])
    
    due_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    story = relationship("UserStory", back_populates="technical_tasks")

class RepositoryContributor(Base):
    __tablename__ = "repository_contributors"

    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    repository = relationship("Repository")
    user = relationship("User")
