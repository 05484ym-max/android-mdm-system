"""Raw ML signal normalization for the local AI service.

This module intentionally contains no ALLOW/BLOCK decision logic and no
HAREDI_STRICT (or any other) policy thresholds. The service returns only
normalized, bounded signal scores from its models. The binding moderation
policy - including every threshold - is owned entirely by the Node backend
(backend/imageModerator.js), which calls this service, receives these raw
signals, and applies its own policy logic before ever persisting a decision.

SIGNAL_SCHEMA_VERSION describes the *shape* of the signals this service
emits, not any decision policy. It changes only when the signal contract
itself changes (a score renamed/added/removed), so a Node deployment can
detect and reject a shape it was not built to understand.
"""

SIGNAL_SCHEMA_VERSION = "LOCAL_AI_SIGNALS_V1"

SIGLIP_PROMPTS = [
    "a photograph of a woman",
    "a photograph of a girl",
    "a photograph of a man",
    "a photograph of a boy",
    "a photograph of a person wearing a swimsuit",
    "a photograph of revealing clothing",
    "a photograph with no person",
]


def bounded(value, default=0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number < 0.0 or number > 1.0:
        return default
    return number
