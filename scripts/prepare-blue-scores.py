"""Build a smaller distribution copy of the blue scores; preserve the source PDFs."""
from pathlib import Path
import re
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "songbooks"
OUTPUT = ROOT / "build" / "blue-scores"
# Only path fills in the original blue slide master, before any notation/text.
PATH_FILL = re.compile(rb"/Pattern\s+cs\s+/P\d+\s+scn\s+(?:[-.\d\s]+[mlhrec]+\s+)+f\*?")
def prepare(source):
    dest = OUTPUT / source.relative_to(SOURCE)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_mtime >= max(source.stat().st_mtime, Path(__file__).stat().st_mtime):
        return
    with pymupdf.open(source) as doc:
        for page in doc:
            for ref in page.get_contents():
                data = doc.xref_stream(ref)
                before, marker, after = data.partition(b"BT")
                if b"0 0.2 0.6 rg" in before and b"/Pattern cs" in before:
                    flat = PATH_FILL.sub(b"n", before)
                    if flat != before:
                        doc.update_stream(ref, flat + marker + after)
        cleaned = doc.tobytes(garbage=4, deflate=True, use_objstms=1)
    with pymupdf.open(stream=cleaned, filetype="pdf") as doc:
        expected = [(page.get_text(), page.get_pixmap().digest) for page in doc]
        try:
            doc.subset_fonts()
            compact = doc.tobytes(garbage=4, deflate=True, use_objstms=1)
            with pymupdf.open(stream=compact, filetype="pdf") as check:
                if len(compact)<len(cleaned) and all((page.get_text(),page.get_pixmap().digest)==target for page,target in zip(check, expected)):
                    cleaned = compact
        except (ValueError,RuntimeError):
            pass
    tmp=dest.with_suffix(".tmp")
    tmp.write_bytes(cleaned)
    tmp.replace(dest)

if __name__=="__main__":
    files=list(SOURCE.rglob("*.pdf"))
    for file in files: prepare(file)
    for old in OUTPUT.rglob("*.pdf"):
        if not (SOURCE/old.relative_to(OUTPUT)).is_file(): old.unlink()
    print("Prepared",len(files),"blue scores")
