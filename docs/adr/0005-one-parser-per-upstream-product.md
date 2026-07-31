# One parser per upstream product

`core/feeds/` holds one parser per upstream **product**, named for the product
rather than the organisation or the measurement:
`coops-predictions.ts`, `ndbc-realtime2.ts`, `inat-observations.ts`. Each
returns a normalized observation record.

## Why

The naming axis was inconsistent, and the inconsistency cost something
measurable. `lib/tide.ts` is named for a measurement and parses NOAA CO-OPS;
`lib/ndbc.ts` is named for a source and returns a type called `Wvht`. A source
module returning a single-measurement type has fused two layers — and that
fusion is why `parseNdbcRealtime2` extracts one column of nineteen and discards
`WDIR`, `WSPD`, `WTMP`, `DPD`, `APD` and `MWD`. Wind, water temperature and
swell period and direction were then written up as future upstream work, when
they were already in the bytes on disk.

**The product is the right grain, finer than the organisation.** NOAA CO-OPS
serves predictions and observations as different payloads on different clocks;
NDBC serves realtime2 and spectral files. The discipline this repo cares about —
header shape, column names, unit strings, timezone label — is a property of the
product. `lib/ndbc.ts` makes the case better than this ADR can: WVHT is in
metres and TIDE, six columns later in the same row, is in feet.

It is also the grain the source registry uses, so a registry entry, a parser and
a probe correspond one-to-one and a check can enforce it. See
[0006](0006-registry-holds-identity-not-assertions.md).

## Considered and rejected

**Measurement directories with source adapters inside** —
`core/feeds/waves/{ndbc-realtime2,cdip}.ts` normalizing to one type per
measurement. It would make `wave.fallback` and the "UI must disclose
substitution" rule structural rather than conventional. Rejected because one
payload serves several measurements: realtime2 would live under `waves` while
also being the only source of wind and water temperature.

## Consequences

- `daylightBounds` leaves `tide.ts`. A solar-position calculation with no
  upstream has no business in a parser whose job is pinning a NOAA payload; it
  moves to `core/spot/daylight.ts`.
- Widening the NDBC return type past `Wvht` is a behaviour change and lands in
  its own PR, but the file is named and placed for it first, so it never moves
  twice.
