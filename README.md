# Statix

Tokens meet art on Solana.

[![Live site](https://img.shields.io/badge/live-statix.bid-blue)](https://statix.bid)

| | |
| --- | --- |
| Chain | Solana |
| Contract address | _pending, will be listed here once published_ |

## Overview

Statix matches tokens with NFT art so that every project gets an identity its holders can see, hold and show off. The site shows a live board of the busiest Solana tokens next to the concept, the route through it, and a set of reserved figures that fill in once the team confirms them.

## Features

- Live Solana radar: the ten boosted tokens with the highest 24h volume, with logo, price, 24h change, volume, liquidity and a copy button for each address
- Rolling ticker fed by the same data, polled once a minute, paused while the tab is hidden, with exponential backoff and last-good-data on failure
- Contract address slot at the top of the page, click to copy, inert until an address is published
- Register-driven links: nothing links anywhere until its record is marked stated
- Spring-physics reveals, hero parallax, spotlight hovers, scroll progress and count-up figures, all disabled under reduced motion

## Links

- Site: https://statix.bid
- X: pending
- GitHub: pending

## Development

```bash
npm run build   # writes dist/
npm run gates   # builds both register branches and runs every check
npm run serve   # serves dist/ on http://localhost:4173
```

`dist/` is the deploy folder. Every external fact lives in `register.json` as one record with a state of `stated`, `absent` or `unconfirmed`; absent and unconfirmed records render inert.

## License

MIT
