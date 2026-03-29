from datetime import datetime
from pydantic import BaseModel


class SessionCreate(BaseModel):
    session_id: str        # UUID from localStorage
    material_id: int


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
    reference: str                   # correct subtitle text for display