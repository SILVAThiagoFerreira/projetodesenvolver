class FlyrockError(Exception):
    """Base exception for operational errors in the flyrock pipeline."""


class DataValidationError(FlyrockError):
    """Raised when required data cannot be processed safely."""


class UnitConversionError(FlyrockError):
    """Raised when a value cannot be converted to a consistent engineering unit."""


class CalculationError(FlyrockError):
    """Raised when a technical calculation cannot be completed safely."""


class ConfigurationError(FlyrockError):
    """Raised when configuration files or schema values are invalid."""


class ExportError(FlyrockError):
    """Raised when a technical export cannot be generated."""
