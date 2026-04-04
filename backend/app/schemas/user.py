from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class UserInitRequest(BaseModel):
    user_id: UUID | None = None   # 前端传已有的；首次传 null


class UserResponse(BaseModel):
    user_id: UUID
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}