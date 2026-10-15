# Scenarios: notion

## Loads it
- "what's on my Notion task list today?"
- "mark the three invoice tasks done in Notion"
- "add a note to my Daily page with today's plan"
- "every weekday at 8, write my plan under Daily"

## Not this one
- "summarise this web page for me"
- "remember: my tasks live in Notion"
- "add Notion as a tool on a new copy of Shipify" (a setup: `pnpm ship add notion`)

## Cases

### 1. A status the database doesn't have
- **Ask:** "mark the invoice task done".
- **Without it:** not yet seen. The risk: a guessed choice ("Completed" where the database says
  "Done") is refused by the tool, so the change never happens.
- **Done well:** `read_database` first, then `update_page` with the exact choice it lists.

### 2. Many changes as one
- **Ask:** "mark these three done".
- **Without it:** not yet seen. The risk: one vague call, or a change claimed as made.
- **Done well:** three `update_page` calls, one per page id, and a reply that says what will
  happen after the Yes, never that it's done.

### 3. A page that wasn't connected
- **Ask:** "read my Reading List page".
- **Without it:** not yet seen. The risk: "not found" read as "doesn't exist".
- **Done well:** the reply says to connect the page to both Shipify integrations in Notion.
