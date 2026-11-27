"""Select and run the offline course checks used by GitHub Actions."""

import argparse
from fnmatch import fnmatchcase
from hashlib import file_digest
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
COURSE = "课堂演示/"
SRC = COURSE + "src/"
ASSETS = COURSE + "assets/"
MEDIA_SOURCE = COURSE + "media-source/"
HTML = COURSE + "从于都到遵义-课堂演示.html"
RELEASE_ARTIFACTS = (
    HTML,
    "展示材料/成果展示/课堂预览.html",
    "展示材料/成果展示/沉浸式VR课程-从于都到遵义-成果展示包.zip",
)
CORE = {"single_screen", "opening", "entry", "desk", "recap"}
EDGE_SHARDS = 4
SPECIAL = {
    "xiang-crossing": ("verify-xiang-crossing.py", False),
    "yudu-shorts": ("verify-yudu-shorts.py", False),
    "route-interactions": ("verify-route-interactions.py", True),
    "desk-live": ("verify-desk-live.py", True),
}
CHECKS = (
    "single_screen", "opening", "entry", "narration", "disclosures", "journeys",
    "controls", "desk", "recap", "reduced-motion", *SPECIAL,
)
RULES = (
    ((SRC + "exploration-page.ts", SRC + "exploration-page.css"),
     ("controls", "xiang-crossing", "yudu-shorts")),
    ((ASSETS + "xiang-crossing/*", MEDIA_SOURCE + "xiang-crossing-tour.*",
      MEDIA_SOURCE + "make-xiang-crossing-tour.py", "Test/verify-xiang-crossing.py"),
     ("xiang-crossing",)),
    ((ASSETS + "yudu-river/*", ASSETS + "yudu-preparation*", MEDIA_SOURCE + "yudu-*",
      "Test/verify-yudu-shorts.py"), ("yudu-shorts", "route-interactions")),
    ((ASSETS + "opening*", SRC + "opening-overlay.ts", MEDIA_SOURCE + "opening-*",
      MEDIA_SOURCE + "make-opening.py"), ("opening",)),
    ((SRC + "route-scenes.ts", "Test/verify-route-interactions.py"),
     ("journeys", "route-interactions")),
    ((SRC + "narration.ts",), ("narration",)),
    ((SRC + "story-scenes*",), ("disclosures",)),
    ((SRC + "page-entry.ts",), ("narration", "journeys", "reduced-motion")),
    ((SRC + "recap-*", ASSETS + "recap-*"), ("disclosures",)),
    ((SRC + "desk-*", ASSETS + "desk-*", "Test/verify-desk-live.py"),
     ("desk-live", "route-interactions")),
)


def changed_paths(base):
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}"],
            cwd=ROOT, stderr=subprocess.DEVNULL,
        ).decode("ascii").strip()
        return subprocess.check_output(
            ["git", "diff", "--no-renames", "--name-only", "-z", commit, "HEAD", "--"],
            cwd=ROOT, stderr=subprocess.DEVNULL,
        ).decode("utf-8").split("\0")[:-1]
    except (OSError, subprocess.CalledProcessError, UnicodeError):
        return None


def select(paths):
    if paths is None:
        return list(CHECKS), {"无法比较 Git 基线": list(CHECKS)}
    reasons = {}
    selected = set(CORE)
    for path in paths:
        if path in RELEASE_ARTIFACTS:
            continue
        checks = {
            check for patterns, matches in RULES
            if any(fnmatchcase(path, pattern) for pattern in patterns)
            for check in matches
        }
        if not checks and (
            path in (".gitattributes", ".gitmodules")
            or (path.startswith((COURSE, "Test/", ".github/")) and not path.endswith(".md"))
        ):
            checks.update(CHECKS)
        if checks:
            reasons[path] = [check for check in CHECKS if check in checks]
            selected.update(checks)
    return [check for check in CHECKS if check in selected], reasons


def html_sha256():
    try:
        with (ROOT / HTML).open("rb") as source:
            return file_digest(source, "sha256").hexdigest()
    except FileNotFoundError:
        return None


def write_report(path, report):
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def plan(output, base):
    tracked = subprocess.check_output(["git", "ls-files", "-z", "--", *RELEASE_ARTIFACTS], cwd=ROOT)
    if tracked:
        names = tracked.decode("utf-8").rstrip("\0").replace("\0", "\n")
        raise SystemExit("以下发布成品应放入 GitHub Release：\n" + names)
    paths = changed_paths(base)
    checks, reasons = select(paths)
    report = {"base": base, "sha256": html_sha256(), "changedPaths": paths,
              "checks": checks, "reasons": reasons}
    output.mkdir(parents=True, exist_ok=True)
    write_report(output / "selection.json", report)
    print("断网 Edge 检查 " + ", ".join(checks), flush=True)


def command(check, output):
    if check in SPECIAL:
        script, named_html = SPECIAL[check]
        html_args = ["--html", HTML] if named_html else [HTML]
        return [sys.executable, "-B", f"Test/{script}", *html_args, "--output", str(output)]
    options = ["--reduced-motion"] if check == "reduced-motion" else []
    feature = "entry" if options else check
    return [sys.executable, "-B", "Test/course_cli.py", "--html", HTML, "--output",
            str(output), *options, "run", feature]


def run(output, shard):
    selection = json.loads((output / "selection.json").read_text(encoding="utf-8"))
    digest = html_sha256()
    if digest is None or digest != selection["sha256"]:
        raise SystemExit("正式课件缺失或在选测后发生变化")
    checks = selection["checks"]
    if shard is not None:
        checks = checks[shard - 1::EDGE_SHARDS]
        print(f"Edge 回归第 {shard}/{EDGE_SHARDS} 组 " + ", ".join(checks), flush=True)
    failed = []
    for check in checks:
        evidence = output / check
        evidence.mkdir(parents=True, exist_ok=True)
        print(f"断网 Edge · {check}", flush=True)
        with (evidence / "console.log").open("w", encoding="utf-8") as log:
            with subprocess.Popen(command(check, evidence), cwd=ROOT, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                  errors="replace") as process:
                for line in process.stdout:
                    print(line, end="", flush=True)
                    log.write(line)
                code = process.wait()
        write_report(evidence / "run.json", {"sha256": digest, "exitCode": code})
        if code:
            failed.append(check)
    if failed:
        raise SystemExit("回归失败 " + ", ".join(failed))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".march-build/ci")
    modes = parser.add_subparsers(dest="mode", required=True)
    modes.add_parser("plan").add_argument("--base", default="")
    modes.add_parser("run").add_argument("--shard", type=int, choices=range(1, EDGE_SHARDS + 1))
    args = parser.parse_args()
    output = args.output.resolve()
    if args.mode == "plan":
        plan(output, args.base)
    else:
        run(output, args.shard)


if __name__ == "__main__":
    main()
