#!/usr/bin/env python3
"""Нормализация source/words/b1_anki.txt -> source/words/B1/*.csv.

Механическая часть prompts/normalize-words.md: артикли, варианты через / и &,
развёртка окончаний прилагательных, пример и аорист из скобок.
Всё, чего нет в исходнике, остаётся пустым. Неразобранные строки -> _todo.txt.

Запуск: python3 tools/normalize-words.py
"""
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "words" / "b1_anki.txt"
OUT = ROOT / "source" / "words" / "B1"
LEVEL = "B1"

ARTICLE_RE = re.compile(r"^(ο/η|η/ο|ο|η|το|οι|τα)\s+")
VARIANT_RE = re.compile(r"\s+[/&]\s+")
BRACKET_RE = re.compile(r"\s*\(([^()]*)\)\s*$")
ENDINGS_RE = re.compile(r"^(?P<lemma>[^,]+),\s*(?P<endings>-[^\s,]+(?:,\s*-[^\s,]+)*)\s*$")
GREEK_RE = re.compile(r"[\u0370-\u03FF\u1F00-\u1FFF]")

HEADERS = {
    "verbs": ["lemma", "alt", "ru", "aorist", "future", "passive", "passive_aorist",
              "root", "level", "theme", "example_gr", "example_ru"],
    "nouns": ["lemma", "alt", "article", "gen_sg", "nom_pl", "gen_pl", "ru", "root",
              "level", "theme", "example_gr", "example_ru"],
    "adjectives": ["lemma", "alt", "fem", "neut", "ru", "comparative", "root", "level",
                   "theme", "example_gr", "example_ru"],
    "other": ["lemma", "alt", "pos", "ru", "level", "theme", "example_gr", "example_ru"],
}


def split_article(text):
    m = ARTICLE_RE.match(text)
    if m:
        return m.group(1), text[m.end():].strip()
    return "", text.strip()


def parse_brackets(ru_raw):
    """'любить (αγάπησα - я полюбил; Σ' αγαπώ - Я тебя люблю)' -> ('любить', [(gr, ru), ...])."""
    ru = ru_raw.strip()
    items = []
    m = BRACKET_RE.search(ru)
    if m:
        ru = ru[:m.start()].strip()
        chunks = []
        for chunk in m.group(1).split(";"):
            if chunk.strip().startswith("- ") and chunks:
                chunks[-1] += ";" + chunk
            else:
                chunks.append(chunk)
        for chunk in chunks:
            chunk = chunk.strip()
            if not chunk:
                continue
            if " - " in chunk:
                gr, ru_ex = chunk.split(" - ", 1)
                items.append((gr.strip(), ru_ex.strip()))
            else:
                items.append((chunk, ""))
    return ru, items


def is_single_greek_word(text):
    return " " not in text and GREEK_RE.search(text) is not None


def expand_adj(stem_lemma, endings):
    """('αγαπημένος', '-η, -ο') -> ('αγαπημένη', 'αγαπημένο'). Окончание -ος/-ός срезается."""
    m = re.match(r"^(.*?)(ος|ός)$", stem_lemma)
    if not m:
        return "", ""
    suffixes = [e.strip().lstrip("-") for e in endings.split(",")]
    if len(suffixes) != 2:
        return "", ""
    return m.group(1) + suffixes[0], m.group(1) + suffixes[1]


def main():
    if not SRC.exists():
        sys.exit(f"нет файла {SRC}")

    rows = {k: [] for k in HEADERS}
    todo = []

    for lineno, line in enumerate(SRC.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            todo.append(f"{lineno}\t{line}\tне 3 колонки")
            continue
        lemma_raw, ru_raw, pos = (p.strip() for p in parts)

        left, *right_parts = VARIANT_RE.split(lemma_raw, maxsplit=1)
        right = right_parts[0] if right_parts else ""
        article, lemma = split_article(left)
        r_article, r_word = split_article(right) if right else ("", "")
        alt = r_word if (not r_article or r_article == article) else right

        ru, items = parse_brackets(ru_raw)
        aorist = ""
        examples = []
        for gr, ru_ex in items:
            if pos == "verb" and not aorist and is_single_greek_word(gr):
                aorist = gr
            else:
                examples.append((gr, ru_ex))
        ex_gr, ex_ru = examples[0] if examples else ("", "")

        base = {"alt": alt, "ru": ru, "level": LEVEL, "theme": "", "root": "",
                "example_gr": ex_gr, "example_ru": ex_ru}

        if pos == "verb":
            row = dict(base, lemma=left.strip(), alt=right,
                       aorist=aorist, future="", passive="", passive_aorist="")
            rows["verbs"].append(row)
        elif pos == "noun":
            row = dict(base, lemma=lemma, article=article or r_article,
                       gen_sg="", nom_pl="", gen_pl="")
            rows["nouns"].append(row)
        elif pos in ("adj", "adj/pronoun"):
            m = ENDINGS_RE.match(left)
            if m:
                stem = m.group("lemma").strip()
                fem, neut = expand_adj(stem, m.group("endings"))
            else:
                stem, fem, neut = left.strip(), "", ""
            row = dict(base, lemma=stem, alt="", fem=fem, neut=neut, comparative="")
            rows["adjectives"].append(row)
        elif pos in ("adv", "adv/prep", "prep", "conj", "pronoun", "particle", "num", "phrase"):
            row = dict(base, lemma=lemma, pos=pos.split("/")[0])
            rows["other"].append(row)
        else:
            todo.append(f"{lineno}\t{line}\tнеизвестная часть речи: {pos}")

    OUT.mkdir(parents=True, exist_ok=True)
    for name, header in HEADERS.items():
        path = OUT / f"{name}.csv"
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=header)
            w.writeheader()
            for r in rows[name]:
                w.writerow({k: r.get(k, "") for k in header})
        print(f"{name}.csv: {len(rows[name])} строк")

    todo_path = OUT / "_todo.txt"
    if todo:
        todo_path.write_text("\n".join(todo) + "\n", encoding="utf-8")
        print(f"_todo.txt: {len(todo)} строк")
    elif todo_path.exists():
        todo_path.unlink()


if __name__ == "__main__":
    main()
