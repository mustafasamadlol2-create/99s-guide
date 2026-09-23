---
name: React version alignment
description: Package-install behavior that caused a blank frontend preview during import setup.
---

Keep the installed React and React DOM versions identical when reinstalling dependencies.

**Why:** Installing a single existing dependency with npm resolved React DOM to a newer compatible range version than React. The server was healthy, but the browser rendered a blank page and reported an incompatible React versions error. Installing the matching version alone required a server restart to clear the dev server's cached dependency bundle.

**How to apply:** After dependency changes, check both resolved versions if the frontend is blank. Align them and restart the development workflow before debugging application code.