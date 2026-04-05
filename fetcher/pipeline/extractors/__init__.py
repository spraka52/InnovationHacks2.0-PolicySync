"""Payer-specific extraction agents for the RxMonitor pipeline."""

from .uhc import extract as uhc_extract
from .cigna import extract as cigna_extract
from .bcbs_nc import extract as bcbs_nc_extract
from .florida_blue import extract as florida_blue_extract
from .priority_health import extract as priority_health_extract
from .emblemhealth import extract as emblemhealth_extract

EXTRACTOR_REGISTRY = {
    "uhc_narrative": uhc_extract,
    "cigna_narrative": cigna_extract,
    "bcbs_nc_multi_drug": bcbs_nc_extract,
    "florida_blue_mcg": florida_blue_extract,
    "priority_health_mdl": priority_health_extract,
    "emblemhealth_docx": emblemhealth_extract,
    "upmc_narrative": uhc_extract,  # UPMC uses same narrative format as UHC
}

__all__ = ["EXTRACTOR_REGISTRY"]
