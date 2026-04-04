from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SessionCreate(BaseModel):
    session_id: str
    material_id: int
    user_id: UUID | None = None   # 匿名用户 ID，由前端从 localStorage 传入


class SessionResponse(BaseModel):
    id: int
    session_id: str
    material_id: int
    started_at: datetime

    model_config = {"from_attributes": True}


class AttemptCreate(BaseModel):
    session_id: str
    subtitle_id: int
    user_input: str
    time_spent: int | None = None    # milliseconds


class DiffTokenOut(BaseModel):
    word: str
    status: str                      # correct | wrong | missing


class AttemptResponse(BaseModel):
    id: int
    subtitle_id: int
    user_input: str
    is_correct: bool
    score: float
    diff: list[DiffTokenOut]
    reference: str