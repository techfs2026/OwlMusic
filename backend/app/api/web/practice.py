import uuid as uuid_lib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.practice import PracticeSession, SentenceAttempt
from app.models.subtitle import Subtitle
from app.schemas.practice import (
    AttemptCreate, AttemptResponse,
    DiffTokenOut, SessionCreate, SessionResponse,
)
from app.services.diff_service import word_diff, score, is_correct

router = APIRouter()


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db),
):
    session = PracticeSession(
        session_id=uuid_lib.UUID(payload.session_id),
        material_id=payload.material_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.post("/sessions/{session_id}/attempts",
             response_model=AttemptResponse, status_code=201)
async def submit_attempt(
    session_id: str,
    payload: AttemptCreate,
    db: AsyncSession = Depends(get_db),
):
    subtitle = await db.get(Subtitle, payload.subtitle_id)
    if not subtitle:
        raise HTTPException(status_code=404, detail="Subtitle not found")

    tokens  = word_diff(subtitle.text, payload.user_input)
    sc      = score(tokens)
    correct = is_correct(tokens)

    attempt = SentenceAttempt(
        session_id=uuid_lib.UUID(session_id),
        subtitle_id=payload.subtitle_id,
        user_input=payload.user_input,
        is_correct=correct,
        score=sc,
        time_spent=payload.time_spent,
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)

    return AttemptResponse(
        id=attempt.id,
        subtitle_id=payload.subtitle_id,
        user_input=payload.user_input,
        is_correct=correct,
        score=sc,
        diff=[DiffTokenOut(word=t.word, status=t.status) for t in tokens],
        reference=subtitle.text,
    )