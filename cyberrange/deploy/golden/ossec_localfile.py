"""Parse Wazuh ossec.conf that may contain two <ossec_config> roots.

The 4.7.5 agent postinst writes one block from gen_ossec.sh and appends a
second <ossec_config> from add_localfiles.sh. ElementTree.parse() rejects
that as junk after the document element; wrapping in a synthetic root
lets us search every block.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET


def parse_ossec_conf(text: str) -> ET.Element:
    return ET.fromstring("<root>" + text + "</root>")


def authlog_syslog_entries(text: str) -> list[ET.Element]:
    root = parse_ossec_conf(text)
    return [
        node
        for node in root.iter("localfile")
        if (node.findtext("location") or "").strip() == "/var/log/auth.log"
        and (node.findtext("log_format") or "").strip() == "syslog"
    ]
