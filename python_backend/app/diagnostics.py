import traceback


def safe_trace(error):
    """Call sites only: omit exception text, SQL parameters, source lines and locals."""
    return " > ".join(
        f"{frame.name}:{frame.lineno}" for frame in traceback.extract_tb(error.__traceback__)
    )
