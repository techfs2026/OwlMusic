import uuid as uuid_lib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
    """
    幂等：同一 session_id 重复请求时跳过 INSERT，直接返回已有记录。
    同时写入 user_id，将练习 session 与匿名用户关联。
    """
    values: dict = dict(
        session_id=uuid_lib.UUID(payload.session_id),
        material_id=payload.material_id,
    )
    if payload.user_id is not None:
        values["user_id"] = payload.user_id

    stmt = (
        pg_insert(PracticeSession)
        .values(**values)
        .on_conflict_do_nothing(index_elements=["session_id"])
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(
        select(PracticeSession).where(
            PracticeSession.session_id == uuid_lib.UUID(payload.session_id)
        )
    )
    session = result.scalar_one()
    return SessionResponse(
        id=session.id,
        session_id=str(session.session_id),
        material_id=session.material_id,
        started_at=session.started_at,
    )


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