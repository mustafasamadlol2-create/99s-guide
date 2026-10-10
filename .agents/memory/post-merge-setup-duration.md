---
name: Post-merge setup duration
description: Runtime expectations for clean install and build after merges in this Replit workspace.
---

The clean `npm ci` plus full production build took about 5 minutes 48 seconds in the Replit workspace; a four-minute post-merge timeout was insufficient. The successful setup used an eight-minute timeout. `npm ci` also runs the package postinstall, which generates Prisma Client, so avoid running that generation a second time in the setup script.

**Why:** The setup was terminated by its timeout before dependency installation and the full build could finish, despite each succeeding when given sufficient time.

**How to apply:** When changing the post-merge setup, preserve the single Prisma generation during install and set the configured timeout with a reasonable buffer above the measured clean-install/build duration.
