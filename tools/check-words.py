#!/usr/bin/env python3
"""Проверка source/words/<уровень>/*.csv.

Ловит: дубли лемм, пустые обязательные поля, латиницу и кириллицу внутри греческих слов,
символ µ вместо μ, многосложные слова без ударения (предупреждение).

Запуск: python3 tools/check-words.py [путь-к-каталогу-уровня]
Код выхода 1, если есть ошибки.
"""
import csv
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORDS = ROOT / "source" / "words"

REQUIRED = {
    "verbs": ["lemma", "ru"],
    "nouns": ["lemma", "article", "ru"],
    "adjectives": ["lemma", "fem", "neut", "ru"],
    "other": ["lemma", "pos", "ru"],
}
GREEK_WORD_RE = re.compile(r"[\u0370-\u03FF\u1F00-\u1FFF]")
BAD_CHARS_RE = re.compile(r"[A-Za-z\u0400-\u04FF]")
VOWELS = set("αεηιουωάέήίόύώΐΰ")
ACCENTED = set("άέήίόύώΐΰΆΈΉΊΌΎΏ")
COMBINING_ACUTE = "\u0301"

errors = []
warnings = []


def syllables(word):
    count = 0
    prev_vowel = False
    for ch in unicodedata.normalize("NFD", word.lower()):
        if ch in "αεηιουω":
            if not prev_vowel:
                count += 1
            prev_vowel = True
        elif ch in "\u0301\u0308":
            prev_vowel = prev_vowel
        else:
            prev_vowel = False
    return count


def has_accent(word):
    nfd = unicodedata.normalize("NFD", word)
    return COMBINING_ACUTE in nfd or any(c in ACCENTED for c in word)


def check_word(where, field, value):
    if not value:
        return
    if "µ" in value:
        errors.append(f"{where}: символ µ (U+00B5) вместо μ в «{value}»")
    for part in re.split(r"[\s,/&()-]+", value):
        if not part:
            continue
        if GREEK_WORD_RE.search(part) and BAD_CHARS_RE.search(part):
            errors.append(f"{where}: латиница/кириллица внутри греческого слова «{part}» ({field})")
    if field in ("lemma", "alt", "fem", "neut", "aorist", "future", "passive", "passive_aorist"):
        for part in re.split(r"[\s,/&()]+", value):
            if not part or not GREEK_WORD_RE.search(part):
                continue
            if syllables(part) >= 2 and not has_accent(part):
                warnings.append(f"{where}: многосложное слово без ударения «{part}» ({field})")


def check_file(level, name, header):
    path = WORDS / level / f"{name}.csv"
    if not path.exists():
        return set()
    seen = {}
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for lineno, row in enumerate(reader, start=2):
            where = f"{level}/{name}.csv:{lineno}"
            for col in REQUIRED[name]:
                if not (row.get(col) or "").strip():
                    errors.append(f"{where}: пусто обязательное поле «{col}»")
            if name == "verbs" and not (row.get("aorist") or "").strip():
                warnings.append(f"{where}: нет аориста «{row.get('lemma')}», дозаполнить")
            lemma = (row.get("lemma") or "").strip()
            if lemma:
                if lemma in seen:
                    errors.append(f"{where}: дубль леммы «{lemma}» (уже на строке {seen[lemma]})")
                else:
                    seen[lemma] = lineno
            for field, value in row.items():
                check_word(where, field, (value or "").strip())
    return set(seen)


def main():
    levels = [Path(sys.argv[1])] if len(sys.argv) > 1 else sorted(
        p for p in WORDS.iterdir() if p.is_dir() and p.name not in ("",) and p.name[0] != "_"
    )
    for level_dir in levels:
        level = level_dir.name
        lemmas_by_file = {}
        for name, header in REQUIRED.items():
            lemmas_by_file[name] = check_file(level, name, header)
        names = list(lemmas_by_file)
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                for dup in sorted(lemmas_by_file[a] & lemmas_by_file[b]):
                    warnings.append(f"{level}: лемма «{dup}» есть и в {a}.csv, и в {b}.csv")

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print(f"\nОшибок: {len(errors)}, предупреждений: {len(warnings)}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
