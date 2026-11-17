# Prescouting (moved)

Prescouting is now a tab in Scouting (#184), right after Overview: see
[Scouting's Prescouting README](../scouting/prescouting/README.md).

This module is only here so old links and bookmarks keep working. It's
hidden from the menu and the home page for everyone, and its page
(`MovedPage.tsx`) sends `#/prescouting` to `#/scouting/prescouting`, and
`#/prescouting/<event>/<team>` to `#/scouting/prescouting/<event>/<team>`
(`movedHref()` in `data.ts`).

Once nobody uses the old links (after a season, say), a mentor can delete
this folder and take `prescouting` out of `src/modules/index.ts`.
