from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def migrate_schema() -> None:
    inspector = inspect(engine)
    if "year_plan_entries" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("year_plan_entries")}
    if "school_holiday" not in columns:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE year_plan_entries ADD COLUMN school_holiday VARCHAR(50)")
            )

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
