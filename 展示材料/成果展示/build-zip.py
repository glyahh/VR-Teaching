"""把当前成果页与已构建的单文件课件打入发布包。"""

from hashlib import file_digest
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile


SHOWCASE = Path(__file__).resolve().parent
ROOT = SHOWCASE.parents[1]
COURSE = ROOT / "课堂演示" / "从于都到遵义-课堂演示.html"
FILES = ("成果与计划.html", "课堂预览.html")
DESTINATION = SHOWCASE / "沉浸式VR课程-从于都到遵义-成果展示包.zip"


def sha256(path):
    with path.open("rb") as source:
        return file_digest(source, "sha256").hexdigest()


def main():
    preview = SHOWCASE / FILES[1]
    if not COURSE.is_file() or not preview.is_file() or sha256(COURSE) != sha256(preview):
        raise SystemExit('正式课件与成果预览应来自同次构建。请运行 node "课堂演示/build.mjs"。')

    members = {f"成果展示/{name}": SHOWCASE / name for name in FILES}
    build_dir = ROOT / ".march-build"
    build_dir.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=build_dir) as directory:
        staging = Path(directory) / DESTINATION.name
        with ZipFile(staging, "w", compression=ZIP_DEFLATED) as archive:
            for member, source in members.items():
                archive.write(source, member)
        with ZipFile(staging) as archive:
            for member, source in members.items():
                with archive.open(member) as packed:
                    if file_digest(packed, "sha256").hexdigest() != sha256(source):
                        raise SystemExit(f"发布包校验失败：{member}")
        staging.replace(DESTINATION)
    print(DESTINATION)


if __name__ == "__main__":
    main()
