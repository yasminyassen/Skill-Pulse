from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Float, JSON, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base
import enum

# Roles
class UserRole(str, enum.Enum):
    developer = "developer"
    manager = "manager"
    recruiter = "recruiter"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    github_id = Column(String, unique=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    role = Column(Enum(UserRole), default=UserRole.developer)
    avatar_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    repositories = relationship("Repository", back_populates="owner")

class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    github_repo_id = Column(String, unique=True, index=True)
    name = Column(String)
    full_name = Column(String)
    url = Column(String)
    is_private = Column(Integer, default=0)
    owner_id = Column(Integer, ForeignKey("users.id"))
    connected_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="repositories")
    analysis_runs = relationship("AnalysisRun", back_populates="repository")

class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"))
    status = Column(String, default="pending")
    triggered_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    repository = relationship("Repository", back_populates="analysis_runs")
    code_metrics = relationship("CodeMetrics", back_populates="analysis_run")
    security_findings = relationship("SecurityFinding", back_populates="analysis_run")
    skill_scores = relationship("SkillScore", back_populates="analysis_run")

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
    file_path = Column(String)
    owasp_category = Column(String)
    severity = Column(String)
    description = Column(Text)
    line_number = Column(Integer, nullable=True)

    analysis_run = relationship("AnalysisRun", back_populates="security_findings")

class SkillScore(Base):
    __tablename__ = "skill_scores"

    id = Column(Integer, primary_key=True, index=True)
    analysis_run_id = Column(Integer, ForeignKey("analysis_runs.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    code_quality_score = Column(Float)
    maintainability_score = Column(Float)
    security_awareness_score = Column(Float)
    problem_solving_score = Column(Float)
    overall_score = Column(Float)

    analysis_run = relationship("AnalysisRun", back_populates="skill_scores")