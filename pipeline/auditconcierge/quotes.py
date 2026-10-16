"""Verbatim quote check (same idea as Stockplify's quote_check): a value is kept only if the
quote it came from really appears in the source document's text."""
from .normalize import squash


def verify(quote: str, source_text: str) -> bool:
    q = squash(quote)
    return bool(q) and q in squash(source_text)
