from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Float, JSON, Enum, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base
from datetime import datetime, timedelta
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
    username = Column(String, unique=True, index=True, nullable=False) 
    full_name = Column(String, nullable=False) 
    work_email = Column(String, unique=True, index=True, nullable=False) 
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=True, default=None)
    avatar_url = Column(String, nullable=True)
    github_access_token = Column(String, nullable=True)  # stored encrypted
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    analysis_runs = relationship("AnalysisRun", back_populates="user")

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

class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    branch = Column(String, default="main")
    status = Column(String, default="pending")
    triggered_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    repository = relationship("Repository", back_populates="analysis_runs")
    code_metrics = relationship("CodeMetrics", back_populates="analysis_run")
    security_findings = relationship("SecurityFinding", back_populates="analysis_run")
    skill_scores = relationship("SkillScore", back_populates="analysis_run")
    user = relationship("User", back_populates="analysis_runs")
    ai_insights = Column(JSON, nullable=True)
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