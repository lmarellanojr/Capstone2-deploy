import xml.etree.ElementTree as ET

from ossec_localfile import authlog_syslog_entries, parse_ossec_conf

TWO_BLOCK = """
<ossec_config>
  <client>
    <server>
      <address>MANAGER_IP</address>
    </server>
  </client>
</ossec_config>
<ossec_config>
  <localfile>
    <log_format>syslog</log_format>
    <location>/var/log/auth.log</location>
  </localfile>
</ossec_config>
"""

SINGLE_BLOCK = """
<ossec_config>
  <localfile>
    <log_format>syslog</log_format>
    <location>/var/log/auth.log</location>
  </localfile>
</ossec_config>
"""


def test_elementtree_parse_rejects_two_root_blocks():
    try:
        ET.fromstring(TWO_BLOCK)
    except ET.ParseError as error:
        assert "junk after document element" in str(error)
    else:
        raise AssertionError("two-block ossec.conf must fail a single-root parse")


def test_wrapper_finds_one_authlog_syslog_entry_in_two_block_conf():
    entries = authlog_syslog_entries(TWO_BLOCK)
    assert len(entries) == 1
    assert (entries[0].findtext("location") or "").strip() == "/var/log/auth.log"
    assert (entries[0].findtext("log_format") or "").strip() == "syslog"


def test_wrapper_still_finds_entry_in_single_block_conf():
    assert len(authlog_syslog_entries(SINGLE_BLOCK)) == 1
    assert parse_ossec_conf(SINGLE_BLOCK).find("ossec_config") is not None
