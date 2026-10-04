import logging

from app.config import Settings
from app.factory import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = create_app(Settings.from_env())
