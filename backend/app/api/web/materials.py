from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.material import AudioMaterial
from app.models.subtitle import Subtitle
from app.schemas.material import MaterialListItem
from app.schemas.subtitle import SubtitleListResponse, SubtitleResponse
from app.storage.factory import get_storage

router = APIRouter()


@router.get("", response_model=list[MaterialListItem])
async def list_published_materials(db: AsyncSession = Depends(get_db)):
    """Return only verified materials for the practice web UI."""
    result = await db.execute(
        select(AudioMaterial)
        .where(AudioMaterial.status == "verified")
        .order_by(AudioMaterial.created_at.desc())
    )
    materials = result.scalars().all()
    storage = get_storage()

    items = []
    for m in materials:
        count_result = await db.execute(
            select(Subtitle).where(Subtitle.material_id == m.id)
        )
        subtitle_count = len(count_result.scalars().all())
        items.append(MaterialListItem(
            id=m.id,
            title=m.title,
            filename=m.filename,
            duration=m.duration,
            status=m.status,
            created_at=m.created_at,
            audio_url=storage.get_url(m.file_path),
            subtitle_count=subtitle_count,
        ))
    return items


@router.get("/{material_id}/subtitles", response_model=SubtitleListResponse)
async def get_web_subtitles(
    material_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return subtitles for a verified material (web practice use)."""
    material = await db.get(AudioMaterial, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    if material.status != "verified":
        raise HTTPException(status_code=403, detail="Material is not verified yet")

    result = await db.execute(
        select(Subtitle)
        .where(Subtitle.material_id == material_id)
        .order_by(Subtitle.seq)
    )
    subtitles = result.scalars().all()
    verified_count = sum(1 for s in subtitles if s.is_verified)

    return SubtitleListResponse(
        material_id=material_id,
        subtitles=[SubtitleResponse.model_validate(s) for s in subtitles],
        total=len(subtitles),
        verified_count=verified_count,
    )