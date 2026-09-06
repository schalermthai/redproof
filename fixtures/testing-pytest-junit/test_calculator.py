import pytest
from src.calculator import add


def test_adds_numbers():
    assert add(2, 3) == 5
