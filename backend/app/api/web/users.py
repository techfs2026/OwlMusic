from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.lib.username_gen import generate_username
from app.models.user import User
from app.schemas.user import UserInitRequest, UserResponse

router = APIRouter()


@router.post("/init", response_model=UserResponse)
async def init_user(
    payload: UserInitRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    幂等接口：
    - 前端首次访问传 user_id=null → 生成新用户，返回 user_id + username
    - 后续访问传已有 user_id     → 直接返回已有用户（用户名不变）
    - 传了不存在的 user_id       → 重新创建（应对 localStorage 被清空后 uuid 乱传的情况）
    """
    if payload.user_id is not None:
        result = await db.execute(
            select(User).where(User.user_id == payload.user_id)
        )
        user = result.scalar_one_or_none()
        if user:
            return UserResponse.model_validate(user)

    # 创建新用户
    user = User(username=generate_username())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)