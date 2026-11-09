# Scenarios: frontend-design

## Loads it
- "make a page of my trip plan"
- "a calculator page for splitting the bill"
- "redesign the playground's home page"
- "make the settings screen less cluttered"

## Not this one
- "make a PDF of this" (the `pdf` skill)
- "fix the login bug"
- "share the Diwali photos with Mom and Dad" (the `drop` skill)

## Cases

### 1. A page that leans on what Drop's sandbox blocks
- **Ask:** "make a page of my trip plan: Goa, 12-14 Dec … Add a packing checklist I can tick."
- **Without it:** seen in a baseline with the skill as it was: one file that loads nothing from
  outside, with system fonts, light and dark, and a phone layout, all good. But the checklist kept
  its ticks in `localStorage`, and the reply said the page keeps them in the browser. Drop's
  sandbox gives a page no storage, so the ticks are gone on the next visit, and the page has no
  Save or Open.
- **Done well:** one `.html` file with its CSS, script and data inside it, a system font stack,
  each link with `target="_blank"`, the checklist kept only while the page is open, with Save and
  Open for a copy, readable at 360 px, in light and dark, and under 1 MB.
