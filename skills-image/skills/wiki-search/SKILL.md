Use this skill **before** answering any question that touches a topic the wiki might know about. The wiki is your team brain — past clips, curated articles, query snapshots, and lint reports all live there. Reading the wiki first beats re-deriving from scratch every time.

## When to use

- The user asks a question with a topic ("what's the latest on X", "summarize Y", "compare A vs B")
- The user references prior research ("we wrote about this last week")
- You're about to call `web_fetch` for something — check the wiki first; you may already have a clip
- You want to find related articles to cross-link a new one you're writing

## Procedure

Use `exec` to run ripgrep over the KB mount path. ripgrep is preinstalled in the gateway image. Markdown is plain text, so substring matches work fine; the `--smart-case` flag handles capitalization gracefully.

### Basic search

```bash
rg --max-count=5 --max-columns=200 --smart-case --type=md \
   '<query>' /home/node/.openclaw/wiki/<kb-name>/
```

- `--max-count=5` — at most 5 hits per file (avoid drowning in long articles)
- `--max-columns=200` — truncate long lines so the model context isn't blown
- `--smart-case` — case-insensitive unless query has uppercase
- `--type=md` — Markdown files only

### Title-only search

Article titles live in YAML frontmatter `title:` or as the first `# ` heading. To bias toward titles:

```bash
rg --files-with-matches --type=md '<query>' /home/node/.openclaw/wiki/<kb-name>/
```

Then `head -1` each hit to read its title — fast even on a few-hundred-article wiki.

### Browse by directory

Conventional layout (see `WIKI.md` for the full list):

- `raw/clips/` — unsorted captures (use `wiki-clip` to add)
- `topics/<area>/` — curated articles
- `concepts/` — canonical concept pages
- `queries/<date>-<topic>.md` — past Q&A snapshots
- `_lint/` — nightly linter reports
- `_index.md` — top-level manifest

`ls /home/node/.openclaw/wiki/<kb-name>/topics/` gives a quick view of areas covered. Read `_index.md` for an editorial overview.

## After searching

- **Cite paths** in your answer: "According to `topics/inference/vllm-batching.md`, …"
- **Note gaps**: if the wiki has nothing on the topic, say so; this is also a hint to use `wiki-clip` or `wiki-write` to start filling the gap.
- **File the result** when the user asks a substantial question: use `wiki-write` to drop a `queries/<date>-<topic>.md` snapshot so future sessions benefit. (Don't do this for trivial questions — only when your synthesis adds value.)

### Append to `log.md` for substantial queries

When you actually file a `queries/<date>-<topic>.md` via `wiki-write`, that skill takes care of the log entry. But you can also log a *search-only* operation when the user asked a real question and you read 2+ wiki pages to answer (no new file written). Keeps the timeline honest about what got looked up:

```bash
# Format: ## [YYYY-MM-DD] <op> | <subject>
echo "## [$(date -u +%Y-%m-%d)] query | <user's question>" \
  >> /home/node/.openclaw/wiki/<kb-name>/log.md
echo "" >> /home/node/.openclaw/wiki/<kb-name>/log.md
echo "Searched <kb-name>. Read: \`<path-1>\`, \`<path-2>\`. By: <agent-id>." \
  >> /home/node/.openclaw/wiki/<kb-name>/log.md
echo "" >> /home/node/.openclaw/wiki/<kb-name>/log.md
```

Skip this for trivial single-page lookups — log only when the answer required real synthesis across multiple wiki sources.

## Tips

- Search broadens with **multiple short queries** rather than one long one. Try the topic, then the related concepts, then specific terms.
- The wiki may contain frontmatter `tags:` lists — `rg 'tags:.*<tag>'` filters by tag.
- For backlinks: `rg --type=md '\\[\\[<page-name>\\]\\]' /home/node/.openclaw/wiki/<kb-name>/` finds every article that references a given concept.
