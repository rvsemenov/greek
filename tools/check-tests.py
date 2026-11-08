#!/usr/bin/env python3
"""Проверка tests/<уровень>/*.json и tests/drill/*.json по схеме из prompts/new-test.md
и prompts/drill.md.

Ошибки (exit 1): битый JSON, несуществующее правило, id не по схеме или повторяется,
неизвестный type, choice без 4 вариантов или с ответом вне options, пустой why,
слово из words нет ни в одном словаре, неизвестный тег, µ вместо μ, смешение алфавитов,
ς не в конце слова, σ в конце слова.

Предупреждения: слово из более высокого уровня, чем тест; многосложное слово без ударения.

    python3 tools/check-tests.py                       # все тесты
    python3 tools/check-tests.py tests/A2/01-aorist-conj1.json
"""
import csv
import importlib.util
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
RULES = ROOT / "source" / "rules"
WORDS = ROOT / "source" / "words"
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
TYPES = {"choice", "inflect", "cloze", "article", "translate"}
NEEDS_OPTIONS = {"choice", "article"}
NEEDS_ACCEPT = {"inflect", "cloze", "translate"}

GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")
LATIN = re.compile(r"[A-Za-z]")
CYRILLIC = re.compile(r"[Ѐ-ӿ]")
WORD = re.compile(r"[\wͰ-Ͽἀ-῿'’-]+")
ACCENTED = set("άέήίόύώΐΰΆΈΉΊΌΎΏ")


def load_rule_helpers():
    spec = importlib.util.spec_from_file_location("check_rules", ROOT / "tools" / "check-rules.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.TAGS, mod.NO_ACCENT_OK, mod.syllables


TAGS, NO_ACCENT_OK, syllables = load_rule_helpers()


def load_dictionary():
    """Все леммы и варианты из всех CSV словаря -> уровень, на котором слово впервые встречается."""
    known = {}
    for path in sorted(WORDS.glob("*/*.csv")):
        level = path.parent.name
        with path.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                for col in ("lemma", "alt", "fem", "neut"):
                    for part in re.split(r"[/&,]", row.get(col) or ""):
                        part = part.strip()
                        if part:
                            known.setdefault(part, level)
    return known


def check_greek_text(where, text, errors, warnings):
    if not text:
        return
    if "µ" in text:
        errors.append(f"{where}: символ µ (U+00B5) вместо μ")
    for w in WORD.findall(text.replace("*", "").replace("___", " ")):
        if GREEK.search(w) and (LATIN.search(w) or CYRILLIC.search(w)):
            errors.append(f"{where}: смешение алфавитов в слове {w!r}")
        letters = re.sub(r"[^\wͰ-Ͽἀ-῿]", "", w)
        if not letters or not GREEK.search(letters):
            continue
        if "ς" in letters[:-1]:
            errors.append(f"{where}: ς не в конце слова: {w!r}")
        if letters[-1] == "σ":
            errors.append(f"{where}: σ в конце слова вместо ς: {w!r}")
        if letters.isupper() or letters.lower() in NO_ACCENT_OK or "-" in w:
            continue
        if syllables(letters) >= 2 and not any(c in ACCENTED for c in unicodedata.normalize("NFC", letters)) \
                and "́" not in unicodedata.normalize("NFD", letters):
            warnings.append(f"{where}: без ударения: {w!r}")


def check_item(item, where, expected_prefix, rule_level, dictionary, errors, warnings):
    iid = item.get("id", "")
    if not re.fullmatch(re.escape(expected_prefix) + r"\d{4}", iid):
        errors.append(f"{where}: id {iid!r} не по схеме {expected_prefix}NNNN")

    where = f"{where} {iid or '?'}"
    typ = item.get("type")
    if typ not in TYPES:
        errors.append(f"{where}: неизвестный type {typ!r}")
    prompt = item.get("prompt", "")
    answer = item.get("answer", "")
    if not prompt:
        errors.append(f"{where}: пустой prompt")
    if not answer:
        errors.append(f"{where}: пустой answer")
    if typ == "cloze" and "___" not in prompt:
        errors.append(f"{where}: cloze без пропуска ___ в prompt")

    options = item.get("options")
    if typ in NEEDS_OPTIONS:
        if not isinstance(options, list) or len(options) != 4 or len(set(options)) != 4:
            errors.append(f"{where}: {typ} требует ровно 4 различных options")
        elif answer not in options:
            errors.append(f"{where}: answer {answer!r} не входит в options")

    accept = item.get("accept")
    if typ in NEEDS_ACCEPT:
        if not isinstance(accept, list) or not accept:
            errors.append(f"{where}: {typ} требует список accept")
        elif answer not in accept:
            errors.append(f"{where}: answer {answer!r} не входит в accept")

    why = item.get("why", "")
    if not why.strip():
        errors.append(f"{where}: пустой why")
    elif not CYRILLIC.search(why):
        errors.append(f"{where}: why должен быть по-русски")

    words = item.get("words")
    if not isinstance(words, list) or not words:
        errors.append(f"{where}: нет words")
    else:
        for w in words:
            if w not in dictionary:
                errors.append(f"{where}: слова {w!r} нет в source/words")
            elif rule_level and LEVELS.index(dictionary[w]) > LEVELS.index(rule_level):
                warnings.append(f"{where}: слово {w!r} из уровня {dictionary[w]}, выше теста {rule_level}")

    tags = item.get("tags")
    if not isinstance(tags, list) or not tags:
        errors.append(f"{where}: нет tags")
    else:
        for t in tags:
            if t not in TAGS:
                errors.append(f"{where}: неизвестный тег {t!r}")

    for field in ("prompt", "answer", "why"):
        check_greek_text(f"{where} {field}", item.get(field, ""), errors, warnings)
    for field in ("options", "accept"):
        for v in item.get(field) or []:
            check_greek_text(f"{where} {field}", v, errors, warnings)


def rule_level_of(rule_id):
    return rule_id.split("/")[0]


def check_level_file(path, rel, rules_known, dictionary, errors, warnings):
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("rule", "title", "level", "items"):
        if key not in data:
            errors.append(f"{rel}: нет поля {key}")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        errors.append(f"{rel}: items пуст или не список")
        return

    rule = data.get("rule", "")
    if rule not in rules_known:
        errors.append(f"{rel}: правило {rule!r} не найдено в source/rules")
        return
    level = data.get("level")
    if level != rule_level_of(rule):
        errors.append(f"{rel}: level={level!r} не совпадает с правилом {rule!r}")
    if rel.parts[1] != level:
        errors.append(f"{rel}: лежит не в папке уровня {level}")

    num = rule.split("/")[1].split("-")[0]
    prefix = f"{level.lower()}-{num}-"
    seen = set()
    for i, item in enumerate(items, start=1):
        if item.get("id") in seen:
            errors.append(f"{rel}[{i}]: повтор id {item.get('id')!r} внутри файла")
        seen.add(item.get("id"))
        check_item(item, f"{rel}[{i}]", prefix, level, dictionary, errors, warnings)


def check_drill_file(path, rel, rules_known, dictionary, errors, warnings):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("kind") != "drill":
        errors.append(f"{rel}: в tests/drill/ нужен kind: \"drill\"")
    date, user = data.get("date", ""), data.get("user", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        errors.append(f"{rel}: date {date!r} не в формате ГГГГ-ММ-ДД")
    if not user:
        errors.append(f"{rel}: нет поля user")
    if path.stem != f"{date}-{user}":
        errors.append(f"{rel}: имя файла должно быть <date>-<user>.json")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        errors.append(f"{rel}: items пуст или не список")
        return

    prefix = f"drill-{date}-"
    seen = set()
    for i, item in enumerate(items, start=1):
        if item.get("id") in seen:
            errors.append(f"{rel}[{i}]: повтор id {item.get('id')!r} внутри файла")
        seen.add(item.get("id"))
        rule = item.get("rule", "")
        if rule not in rules_known:
            errors.append(f"{rel}[{i}]: правило {rule!r} не найдено в source/rules")
            continue
        check_item(item, f"{rel}[{i}]", prefix, rule_level_of(rule), dictionary, errors, warnings)


def check_file(path, rules_known, dictionary, errors, warnings):
    rel = path.relative_to(ROOT)
    try:
        if path.parent.name == "drill":
            check_drill_file(path, rel, rules_known, dictionary, errors, warnings)
        else:
            check_level_file(path, rel, rules_known, dictionary, errors, warnings)
    except json.JSONDecodeError as e:
        errors.append(f"{rel}: битый JSON: {e}")


def main():
    if len(sys.argv) > 1:
        files = [Path(p).resolve() for p in sys.argv[1:]]
    else:
        files = sorted(TESTS.glob("*/*.json"))

    rules_known = {p.relative_to(RULES).with_suffix("").as_posix() for p in RULES.glob("*/*.md")}
    dictionary = load_dictionary()
    errors, warnings = [], []

    for path in files:
        check_file(path, rules_known, dictionary, errors, warnings)

    for w in sorted(set(warnings)):
        print("warn ", w)
    for e in errors:
        print("ERROR", e)
    print(f"\n{len(files)} файлов, {len(errors)} ошибок, {len(set(warnings))} предупреждений")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
