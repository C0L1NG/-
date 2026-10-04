import uuid

import pytest
from sqlalchemy.dialects import postgresql

from app.binding import bind_direct_parent
from app.errors import APIError
from app.models import User, UserRole


class Result:
    def __init__(self, values):
        self.values = values

    def all(self):
        return self.values


class Transaction:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, error_type, *_):
        self.session.committed = error_type is None


class Session:
    def __init__(self, current, parent):
        self.current, self.parent = current, parent
        self.statements = []
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    def begin(self):
        return Transaction(self)

    async def scalars(self, statement):
        self.statements.append(statement)
        return Result([self.current, self.parent])

    async def scalar(self, statement):
        self.statements.append(statement)
        return 0 if len(self.statements) == 2 else self.current.id


@pytest.mark.asyncio
async def test_parent_binding_locks_both_rows_and_sets_parent_once():
    current = User(id=uuid.uuid4(), role=UserRole.AGENT, referral_code="SELF", parent_id=None)
    parent = User(id=uuid.uuid4(), role=UserRole.AGENT, referral_code="ROOT", parent_id=None)
    session = Session(current, parent)
    result = await bind_direct_parent(current.id, "ROOT", lambda: session)
    assert result == {"status": "bound", "parentId": str(parent.id)}
    assert session.committed
    assert "ORDER BY users.id FOR UPDATE" in str(
        session.statements[0].compile(dialect=postgresql.dialect())
    )
    assert len(session.statements) == 3


@pytest.mark.asyncio
async def test_parent_binding_rejects_third_level_without_update():
    current = User(id=uuid.uuid4(), role=UserRole.AGENT, referral_code="SELF", parent_id=None)
    parent = User(
        id=uuid.uuid4(), role=UserRole.AGENT, referral_code="CHILD", parent_id=uuid.uuid4()
    )
    session = Session(current, parent)
    with pytest.raises(APIError) as raised:
        await bind_direct_parent(current.id, "CHILD", lambda: session)
    assert raised.value.code == "THIRD_LEVEL_FORBIDDEN"
    assert not session.committed and len(session.statements) == 1
