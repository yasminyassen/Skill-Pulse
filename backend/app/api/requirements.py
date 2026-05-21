import os
import tempfile
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status, Form
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.db.models import RequirementDocument, UserRole, UserStory, DocumentType, DocumentStatus, User, TechnicalTask, Repository, RepositoryContributor, TaskStatus
from app.api.auth import get_current_user 
from app.schemas.prd_schemas import UserStoryResponse, ExtractionResultResponse, TechnicalTaskUpdate, TechnicalTaskCreate, TechnicalTaskResponse, UserStoryUpdate, TaskMergeRequest
from ai_services.requirements.prd_extractor import parse_prd_to_stories
from datetime import datetime, timezone
from sqlalchemy.orm import joinedload
from app.services.github_client import fetch_repo_collaborators
from app.core.auth_utils import decrypt_github_token

router = APIRouter(prefix="/requirements", tags=["Requirements & User Stories"])

@router.post("/upload", response_model=ExtractionResultResponse)
async def upload_and_extract_prd(
    file: UploadFile = File(...),
    repository_id: int = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only managers can upload PRD documents."
        )

    ext = os.path.splitext(file.filename)[1].lower()
    doc_type = None
    
    if ext == ".pdf": 
        doc_type = DocumentType.pdf
    elif ext in [".md", ".txt"]: 
        doc_type = DocumentType.markdown
    elif ext in [".xlsx", ".xls", ".csv"]: 
        doc_type = DocumentType.excel
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    db_doc = RequirementDocument(
        uploaded_by_id=current_user.id,
        repository_id=repository_id,
        title=file.filename,
        original_filename=file.filename,
        file_type=doc_type,
        status=DocumentStatus.processing
    )
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name

        extracted_stories = await parse_prd_to_stories(temp_path)
        
        os.remove(temp_path)

        db_stories = []
        for story_data in extracted_stories:
            new_story = UserStory(
                document_id=db_doc.id,
                story_code=story_data.get("story_code", "US-XXX"),
                title=story_data.get("title", "Untitled"),
                role=story_data.get("role", "user"),
                feature=story_data.get("feature", ""),
                benefit=story_data.get("benefit", ""),
                description=story_data.get("description", ""),
                acceptance_criteria=story_data.get("acceptance_criteria", []),
                priority=story_data.get("priority", "medium").lower(),
                tags=story_data.get("tags", [])
            )
            
            tasks_data = story_data.get("technical_tasks", [])
            for task_data in tasks_data:
                new_task = TechnicalTask(
                    description=task_data.get("description", ""),
                    type=task_data.get("type", "backend"),
                    ac_ids=task_data.get("ac_ids", [])
                )
                new_story.technical_tasks.append(new_task)

            db_stories.append(new_story)
        
        db.add_all(db_stories)
        
        db_doc.status = DocumentStatus.extracted
        db_doc.processed_at = datetime.now(timezone.utc)
        
        db.commit()

        return ExtractionResultResponse(
            document_id=db_doc.id,
            status=db_doc.status,
            stories_extracted=len(db_stories),
            processed_at=db_doc.processed_at
        )

    except Exception as e:
        db_doc.status = DocumentStatus.failed
        db_doc.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{doc_id}/stories", response_model=List[UserStoryResponse])
def get_document_stories(
    doc_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    stories = db.query(UserStory)\
        .options(joinedload(UserStory.technical_tasks))\
        .filter(UserStory.document_id == doc_id)\
        .all()
        
    if not stories:
        raise HTTPException(status_code=404, detail="No stories found for this document.")
    return stories

@router.patch("/tasks/{task_id}", response_model=TechnicalTaskResponse)
def update_technical_task(
    task_id: int,
    task_update: TechnicalTaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(status_code=403, detail="Only managers can edit tasks.")

    db_task = db.query(TechnicalTask).filter(TechnicalTask.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found.")

    update_data = task_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_task, key, value)

    db.commit()
    db.refresh(db_task)
    return db_task

@router.post("/stories/{story_id}/tasks", response_model=TechnicalTaskResponse)
def create_manual_task(
    story_id: int,
    task_in: TechnicalTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(status_code=403, detail="Only managers can add tasks.")

    story = db.query(UserStory).filter(UserStory.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found.")

    new_task = TechnicalTask(
        story_id=story_id,
        description=task_in.description,
        type=task_in.type,
        ac_ids=task_in.ac_ids,
        status=task_in.status,
        due_date=task_in.due_date
    )
    
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task

@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_technical_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(status_code=403, detail="Only managers can delete tasks.")

    db_task = db.query(TechnicalTask).filter(TechnicalTask.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found.")

    db.delete(db_task)
    db.commit()
    return

@router.post("/repositories/{repo_id}/sync-contributors")
async def sync_contributors_endpoint(
    repo_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(status_code=403, detail="Only managers can sync repos.")

    repo = db.query(Repository).filter(Repository.id == repo_id).first()
    if not repo or not repo.url:
        raise HTTPException(status_code=404, detail="Repository not found or has no URL.")

    parts = repo.url.rstrip("/").split("/")
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="Invalid repository URL format.")
    full_name = f"{parts[-2]}/{parts[-1]}"

    manager_token = None
    if current_user.github_access_token:
        try:
            manager_token = decrypt_github_token(current_user.github_access_token)
        except Exception:
            raise HTTPException(status_code=401, detail="Failed to decrypt GitHub token.")
    collaborators_data = await fetch_repo_collaborators(manager_token, full_name)

    added_count = 0
    for contributor in collaborators_data:
        github_login = contributor.get("login")
        
        user = db.query(User).filter(User.username == github_login).first()
        
        if not user:
            continue 

        link_exists = db.query(RepositoryContributor).filter(
            RepositoryContributor.repository_id == repo.id,
            RepositoryContributor.user_id == user.id
        ).first()

        if not link_exists:
            new_link = RepositoryContributor(repository_id=repo.id, user_id=user.id)
            db.add(new_link)
            added_count += 1
            
    db.commit()
    return {"message": f"Successfully linked {added_count} existing users as contributors for this repo."}

@router.get("/repositories/{repo_id}/stories", response_model=List[UserStoryResponse])
def get_stories_by_repository(
    repo_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    stories = db.query(UserStory)\
        .join(RequirementDocument, UserStory.document_id == RequirementDocument.id)\
        .options(joinedload(UserStory.technical_tasks))\
        .filter(RequirementDocument.repository_id == repo_id)\
        .all()
        
    return stories    

@router.post("/{doc_id}/confirm", status_code=status.HTTP_200_OK)
def confirm_requirement_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(status_code=403, detail="Only managers can confirm requirements.")
        
    doc = db.query(RequirementDocument).filter(RequirementDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    doc.status = DocumentStatus.extracted 
    db.commit()
    
    return {"message": "Requirements confirmed and published successfully."}

@router.patch("/stories/{story_id}", response_model=UserStoryResponse)
def update_user_story(
    story_id: int,
    story_update: UserStoryUpdate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(status_code=403, detail="Only managers can edit stories.")
        
    db_story = db.query(UserStory).filter(UserStory.id == story_id).first()
    if not db_story:
        raise HTTPException(status_code=404, detail="Story not found.")
        
    update_data = story_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_story, key, value)
        
    db.commit()
    db.refresh(db_story)
    return db_story

@router.post("/stories/{story_id}/tasks/merge", response_model=TechnicalTaskResponse)
def merge_technical_tasks(
    story_id: int,
    merge_req: TaskMergeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.value != "manager":
        raise HTTPException(status_code=403, detail="Only managers can merge tasks.")
        
    tasks_to_merge = db.query(TechnicalTask).filter(
        TechnicalTask.id.in_(merge_req.task_ids),
        TechnicalTask.story_id == story_id
    ).all()
    
    if len(tasks_to_merge) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 tasks to merge.")
        
    combined_ac_ids = set()
    for t in tasks_to_merge:
        if t.ac_ids:
            combined_ac_ids.update(t.ac_ids)
            
    task_type = tasks_to_merge[0].type

    new_task = TechnicalTask(
        story_id=story_id,
        description=merge_req.new_description,
        type=task_type,
        ac_ids=list(combined_ac_ids),
        status=TaskStatus.todo
    )
    db.add(new_task)
    for t in tasks_to_merge:
        db.delete(t)
        
    db.commit()
    db.refresh(new_task)
    return new_task

@router.get("/repositories/{repo_id}/contributors")
def get_repo_contributors(
    repo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    contributors = (
        db.query(User)
        .join(RepositoryContributor, RepositoryContributor.user_id == User.id)
        .filter(
                RepositoryContributor.repository_id == repo_id,
                User.role == UserRole.developer)
        .all()
    )
    return [
        {
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "email": u.work_email,
        }
        for u in contributors
    ]