# Scenarios: writing-skills

## Loads it
- "shipify: add to the systematic-debugging skill: check the box's clock before trusting log times"
- "make a skill for writing Dockerfiles"
- "frontend-design keeps loading on backend work, fix its description"
- "the notebook keeps getting how-to notes, turn them into a skill"

## Not this one
- "turn on the daily brief recipe"
- "remember: I like dark mode"
- "add a check that watches the site's status code"

## Cases

### 1. A header that one agent can't read
- **Ask:** add a skill whose description has a colon in it.
- **Without it:** the Notion skill's description went in unquoted, with a `: ` in it. pi reads
  headers strictly and skipped the skill without a word, so pi runs never saw it, until the skill
  check caught it.
- **Done well:** the description is quoted, and the skill check (`make verify`) passes.

### 2. A description too long to scan
- **Ask:** keep every skill's description useful in the list every run reads.
- **Without it:** security-and-hardening's description had grown to almost 600 characters of
  repeated "Use when …" clauses, read by every run that gets skills.
- **Done well:** one "Use when …" line of the situations, 300 characters at most.

### 3. A description that tells the steps
- **Ask:** write the description for a skill with a fixed method.
- **Without it:** in superpowers' tests of this method, a description that summed up the steps
  ("…, then write the test, then …") made agents follow the summary and never open the skill.
- **Done well:** the description says only when to use it; the steps stay in the body.
