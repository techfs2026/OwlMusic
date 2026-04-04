# Import all models here so Alembic's autogenerate can detect them.
from app.models.user import User
from app.models.material import AudioMaterial
from app.models.subtitle import Subtitle
from app.models.practice import PracticeSession, SentenceAttempt

__all__ = ["User", "AudioMaterial", "Subtitle", "PracticeSession", "SentenceAttempt"]