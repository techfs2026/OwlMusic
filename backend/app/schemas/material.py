from datetime import datetime
from pydantic import BaseModel


class MaterialResponse(BaseModel):
    id: int
    title: str
    filename: str
    file_hash: str
    duration: float | None
    status: str
    created_at: datetime
    audio_url: str

    model_config = {"from_attributes": True}


class MaterialListItem(BaseModel):
    id: int
    title: str
    filename: str
    duration: float | None
    status: str
    created_at: datetime
    audio_url: str
    subtitle_count: int = 0

    model_config = {"from_attributes": True}


class PaginatedMaterials(BaseModel):
    items: list[MaterialListItem]
    total: int
    page: int
    page_size: int
    total_pages: int