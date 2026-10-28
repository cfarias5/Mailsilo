from __future__ import annotations

import pytest

from app.api import deps


class FakeSession:
    def __init__(self):
        self.close_calls = 0

    def close(self):
        self.close_calls += 1


def test_get_db_yields_a_session_and_closes_it(monkeypatch):
    fake = FakeSession()
    monkeypatch.setattr("app.database.get_session", lambda: fake)

    generator = deps.get_db()
    assert next(generator) is fake

    with pytest.raises(StopIteration):
        next(generator)

    assert fake.close_calls == 1


def test_get_db_closes_the_session_when_the_request_fails(monkeypatch):
    fake = FakeSession()
    monkeypatch.setattr("app.database.get_session", lambda: fake)

    generator = deps.get_db()
    assert next(generator) is fake

    with pytest.raises(RuntimeError, match="boom"):
        generator.throw(RuntimeError("boom"))

    assert fake.close_calls == 1


def test_api_routers_do_not_depend_on_the_leaky_session():
    from app.api import accounts, emails, folders
    from app.api.deps import get_db
    from app.database import get_session

    closing_dependencies = 0
    for module in (accounts, emails, folders):
        for route in module.router.routes:
            for dependency in route.dependant.dependencies:
                assert dependency.call is not get_session
                if dependency.call is get_db:
                    closing_dependencies += 1

    assert closing_dependencies > 0
