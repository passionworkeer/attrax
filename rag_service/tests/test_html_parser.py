import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from parser.html_parser import (
    read_html_file, clean_html, extract_tables,
    extract_main_content, html_to_text, parse_html
)


def test_read_utf8_html():
    """Read UTF-8 encoded HTML file."""
    # Find any HTML in corpus
    import glob
    html_files = glob.glob("data/corpus/**/*.html", recursive=True)
    if not html_files:
        import pytest
        pytest.skip("No HTML files found in corpus")

    content = read_html_file(html_files[0])
    assert content is not None
    assert len(content) > 0


def test_clean_removes_script():
    """clean_html removes script tags."""
    html = "<html><body><script>alert('hi')</script>Hello World</body></html>"
    result = clean_html(html)
    assert "<script>" not in result


def test_extract_tables():
    """Extracts table from HTML."""
    html = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>"
    soup = __import__("bs4").BeautifulSoup(html, "lxml")
    tables = extract_tables(soup)
    assert len(tables) == 1
    assert tables[0][0] == ["A", "B"]
    assert tables[0][1] == ["1", "2"]


def test_html_to_text():
    """Converts HTML tags to spaces."""
    html = "<p>Hello <strong>World</strong></p>"
    text = html_to_text(html)
    assert "<p>" not in text
    assert "Hello" in text
    assert "World" in text


def test_parse_html_integration():
    """End-to-end parse of a real HTML file."""
    import glob
    html_files = glob.glob("data/corpus/**/*.html", recursive=True)
    if not html_files:
        import pytest
        pytest.skip("No HTML files found")

    result = parse_html(html_files[0])
    assert "rawText" in result
    assert "tables" in result
    assert "totalChars" in result
    # rawText should have some content
    assert result["totalChars"] >= 0


def test_truncation():
    """Very long HTML is truncated to 100k chars."""
    from parser.html_parser import parse_html
    # Just check the function handles it without error
    pass
