class FlyrockError(Exception):
    """Base exception for operational errors in the flyrock pipeline."""


class DataValidationError(FlyrockError):
    """Raised when required data cannot be processed safely."""
