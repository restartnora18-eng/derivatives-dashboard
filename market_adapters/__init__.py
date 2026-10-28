"""Optional public-data adapters; existing collectors are unchanged."""
from .readonly import AdapterError, ReadOnlyAdapter, load_config

__all__ = ['AdapterError', 'ReadOnlyAdapter', 'load_config']
