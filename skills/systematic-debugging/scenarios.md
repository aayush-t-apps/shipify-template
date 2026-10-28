# Scenarios: systematic-debugging

## Loads it
- "the tests fail and I don't know why"
- "the run lost communication, fix it"

## Not this one
- "remember: I like dark mode"
- "add a button to the page"

## Cases

### 1. A box reset read as a code bug
- **Ask:** a self-hosted run lost communication; find out why.
- **Without it:** the agent searched the code for the cause, but the box had reset.
- **Done well:** check the box's uptime and reset cause (on a Pi, the bootloader `rsts` value) before you suspect the code.
