from fastapi import APIRouter

# Admin routers
from app.api.admin import materials as admin_materials
from app.api.admin import subtitles as admin_subtitles
from app.api.admin import tasks as admin_tasks

# Web routers
from app.api.web import materials as web_materials
from app.api.web import practice as web_practice
from app.api.web import ai as web_ai
from app.api.web import stats as web_stats
from app.api.web import users as web_users

router = APIRouter()

# ── admin ─────────────────────────────────────────────────────────────────────
router.include_router(
    admin_materials.router,
    prefix="/api/admin/materials",
    tags=["admin:materials"],
)
router.include_router(
    admin_subtitles.router,
    prefix="/api/admin/materials",
    tags=["admin:subtitles"],
)
router.include_router(
    admin_tasks.router,
    prefix="/api/admin",
    tags=["admin:tasks"],
)

# ── web ───────────────────────────────────────────────────────────────────────
router.include_router(
    web_users.router,     
    prefix="/api/web/users",     
    tags=["web:users"],
)

router.include_router(
    web_materials.router,
    prefix="/api/web/materials",
    tags=["web:materials"],
)
router.include_router(
    web_practice.router,
    prefix="/api/web",
    tags=["web:practice"],
)
router.include_router(
    web_ai.router,
    prefix="/api/web/ai",
    tags=["web:ai"],
)
router.include_router(
    web_stats.router,
    prefix="/api/web",
    tags=["web:stats"],
)