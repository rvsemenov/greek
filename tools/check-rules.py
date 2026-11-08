#!/usr/bin/env python3
"""Проверка source/rules/**/*.md.

Ошибки (exit 1): битый frontmatter, id не совпадает с путём, неизвестный тег,
requires на несуществующее правило или на более высокий уровень, символ µ (U+00B5)
вместо μ, латинская/кириллическая буква внутри греческого слова, нет раздела
«Типичные ошибки».

Предупреждения: многосложное греческое слово без ударения.

    python3 tools/check-rules.py            # проверить
    python3 tools/check-rules.py --index    # проверить и пересобрать source/rules/README.md
"""
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / "source" / "rules"
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
FIELDS = ["id", "title", "level", "tags", "requires", "source"]
REQUIRED_FIELDS = ["id", "title", "level", "tags", "requires"]
TAGS = set("""
phonetics alphabet stress articles nouns cases nominative accusative genitive
adjectives adverbs comparison pronouns numbers prepositions verbs present past future
aorist imperfect perfect passive subjunctive imperative participles irregular negation
questions conjunctions syntax conditionals modality word-formation register
""".split())

GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")
LATIN = re.compile(r"[A-Za-z]")
CYRILLIC = re.compile(r"[Ѐ-ӿ]")
TRANSCRIPTION = re.compile(r"\[[^\]]*\](?!\()")
WORD = re.compile(r"[\wͰ-Ͽἀ-῿'’-]+")
# односложные по синизесу (ι + гласная = один слог) — пишутся без ударения
NO_ACCENT_OK = set("""
για γεια μια μιας πια πιο δυο πιω πιεις πιει πιες πιουν γιος γιοι ποιος ποια ποιο ποιοι ποιες ποιου ποιας ποιων ποιον ποιους
τριων τρεις
""".split())
VOWEL_GROUPS = re.compile(r"(αι|ει|οι|ου|υι|αυ|ευ|ηυ|[αεηιουω])")


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def syllables(word):
    w = strip_accents(word.lower())
    return len(VOWEL_GROUPS.findall(w))


def parse_frontmatter(text):
    if not text.startswith("---\n"):
        return None, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return None, text
    meta, keys = {}, []
    for line in text[4:end].splitlines():
        if not line.strip():
            continue
        m = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if not m:
            return None, text
        k, v = m.group(1), m.group(2).strip()
        if v.startswith("[") and v.endswith("]"):
            v = [x.strip() for x in v[1:-1].split(",") if x.strip()]
        meta[k] = v
        keys.append(k)
    meta["__keys__"] = keys
    return meta, text[end + 5:]


def main():
    files = sorted(p for p in RULES.glob("*/*.md"))
    rules, errors, warnings = {}, [], []

    for p in files:
        rel = p.relative_to(RULES)
        text = p.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        if meta is None:
            errors.append(f"{rel}: нет или битый frontmatter")
            continue
        keys = meta.pop("__keys__")
        for k in REQUIRED_FIELDS:
            if k not in meta:
                errors.append(f"{rel}: нет поля {k}")
        for k in keys:
            if k not in FIELDS:
                errors.append(f"{rel}: лишнее поле {k}")
        expected_id = str(rel.with_suffix(""))
        if meta.get("id") != expected_id:
            errors.append(f"{rel}: id={meta.get('id')!r}, ожидается {expected_id!r}")
        if meta.get("level") != rel.parts[0]:
            errors.append(f"{rel}: level={meta.get('level')!r} не совпадает с папкой {rel.parts[0]}")
        for t in meta.get("tags") or []:
            if t not in TAGS:
                errors.append(f"{rel}: неизвестный тег {t!r}")
        if not isinstance(meta.get("requires", []), list):
            errors.append(f"{rel}: requires должен быть списком")
            meta["requires"] = []
        if "## Типичные ошибки" not in body:
            errors.append(f"{rel}: нет раздела «## Типичные ошибки»")

        for n, line in enumerate(text.splitlines(), 1):
            if "µ" in line:
                errors.append(f"{rel}:{n}: символ µ (U+00B5) вместо μ (U+03BC)")
            # транскрипции [ðро́мос] намеренно смешивают кириллицу с θ/ð — не проверяем
            # «να-форма» — нормальный составной термин, поэтому части через дефис по отдельности
            for w in re.split(r"[\s\-]+", TRANSCRIPTION.sub(" ", line)):
                if GREEK.search(w) and (LATIN.search(w) or CYRILLIC.search(w)):
                    errors.append(f"{rel}:{n}: смешение алфавитов в слове {w!r}")
        for n, line in enumerate(body.splitlines(), 1):
            for w in WORD.findall(line.replace("*", "")):  # **έ**γραψα → έγραψα
                if not GREEK.search(w) or w.startswith("-") or w.endswith("-") or "-" in w:
                    continue
                if w.isupper() or w.lower() in NO_ACCENT_OK:
                    continue
                if syllables(w) >= 2 and "́" not in unicodedata.normalize("NFD", w):
                    warnings.append(f"{rel}: без ударения: {w}")
        rules[meta.get("id")] = {"meta": meta, "rel": rel}

    for rid, r in rules.items():
        lvl = r["meta"].get("level")
        for req in r["meta"].get("requires") or []:
            if req not in rules:
                errors.append(f"{r['rel']}: requires → несуществующее {req}")
            elif LEVELS.index(rules[req]["meta"]["level"]) > LEVELS.index(lvl):
                errors.append(f"{r['rel']}: requires → правило более высокого уровня {req}")

    for w in sorted(set(warnings)):
        print("warn ", w)
    for e in errors:
        print("ERROR", e)
    print(f"\n{len(rules)} правил, {len(errors)} ошибок, {len(set(warnings))} предупреждений")

    if "--index" in sys.argv:
        write_index(rules)
    return 1 if errors else 0


def write_index(rules):
    out = ["# Правила грамматики", "",
           "Сгенерировано `tools/check-rules.py --index` — руками не править.", ""]
    for lvl in LEVELS:
        items = sorted((r for r in rules.values() if r["meta"].get("level") == lvl),
                       key=lambda r: str(r["rel"]))
        if not items:
            continue
        out += [f"## {lvl}", "", "| id | Тема | Нужно знать |", "|---|---|---|"]
        for r in items:
            m = r["meta"]
            reqs = ", ".join(f"`{x}`" for x in m.get("requires") or []) or "—"
            out.append(f"| [`{m['id']}`]({r['rel'].as_posix()}) | {m['title']} | {reqs} |")
        out.append("")
    (RULES / "README.md").write_text("\n".join(out), encoding="utf-8")
    print(f"→ {(RULES / 'README.md').relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
