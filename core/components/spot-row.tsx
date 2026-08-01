'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

/**
 * A grid row with its detail panel disclosed inline.
 *
 * The only reason this is a client component is the open/closed state. The cells
 * and the panel are both rendered on the server and handed in as props, so no
 * tide maths and no upstream data cross into the browser bundle.
 *
 * That server rendering has a cost worth naming, since it is not obvious: a prop
 * handed to a client component is serialised into the RSC flight payload
 * whether or not it is ever displayed. `detail` ships on every request, closed
 * or not. It used to be a full seven-day ribbon, which made it 47% of the
 * payload for content behind a click, and the fix was to stop putting the
 * duplicated cells in it rather than to defer the rendering. Anything added
 * here is paid for by every reader, including the ones who never open a row.
 *
 * Structure matters here. The spot name is a <button> and each day is its own
 * <a>, and they are SIBLINGS in the row. Nesting a link inside the toggle -- or a
 * toggle inside a link -- gives a control that cannot be operated predictably by
 * keyboard and that assistive technology announces as one thing while it behaves
 * as two.
 *
 * Below 600px the toggle is replaced by a plain link to the spot page: the panel
 * is skipped at that width, so offering a control that discloses nothing would be
 * a dead end. Both elements are in the markup and CSS picks one, which keeps the
 * server and client renders identical -- `display: none` also takes the hidden one
 * out of the accessibility tree and out of the tab order.
 */
export function SpotRow({
  spotName,
  spotSlug,
  rowLabel,
  subtitle,
  cells,
  detail,
  columnCount,
}: {
  spotName: string;
  spotSlug: string;
  rowLabel: string;
  /**
   * The one line under the spot's name, composed by the activity.
   *
   * This used to be built here from a `floorFt` and a `usableCount`, which put
   * a reef floor -- an intertidal fact -- inside a shell that #129 needed to
   * serve an activity with no floor at all. A shell may not know what its
   * occupants measure. Each activity now writes the line that makes ITS row
   * readable: tidepool leads with the floor, because that is the only number
   * that differs from the row above it, and surf leads with the ceiling, for the
   * same reason.
   */
  subtitle: string;
  cells: React.ReactNode[];
  detail: React.ReactNode;
  columnCount: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <tbody className="border-b border-[var(--border)] last:border-b-0">
      <tr>
        <th scope="row" className="w-[11rem] p-1 text-left align-middle font-normal">
          {/* >= 600px: disclosure toggle for the inline detail panel. */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={rowLabel}
            onClick={() => setOpen((v) => !v)}
            className="hidden w-full items-start gap-1.5 rounded px-1.5 py-1 text-left hover:bg-[var(--surface-sunken)] wide:flex"
          >
            <span
              aria-hidden
              className="mt-[0.15rem] w-3 shrink-0 text-meta text-[var(--text-dimmer)]"
            >
              {open ? '▾' : '▸'}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-data font-medium leading-tight">
                {spotName}
              </span>
              <span className="block text-meta text-[var(--text-dimmer)]">{subtitle}</span>
            </span>
          </button>

          {/* < 600px: nothing to disclose, so go straight to the spot page. */}
          <Link
            href={`/spot/${spotSlug}`}
            className="block rounded px-1.5 py-1 no-underline wide:hidden"
          >
            <span className="block truncate text-data font-medium leading-tight">
              {spotName}
            </span>
            <span className="block text-meta text-[var(--text-dimmer)]">{subtitle}</span>
          </Link>
        </th>

        {cells.map((cell, i) => (
          <td
            key={i}
            // Only today's column survives below 600px.
            className={i === 0 ? 'p-1 align-top' : 'hidden p-1 align-top wide:table-cell'}
          >
            {cell}
          </td>
        ))}
      </tr>

      {/*
        Rendered only when open, rather than kept in the DOM with the `hidden`
        attribute. Those two do not compose: `hidden` is a UA rule of
        `display: none`, and any author display utility beats it, so a
        `wide:table-row` class would force the panel visible at >= 600px however
        the attribute was set. Conditional rendering also keeps aria-expanded
        truthful without relying on the accessibility tree following a CSS rule.
      */}
      {open ? (
        <tr id={panelId} className="hidden wide:table-row">
          <td colSpan={columnCount} className="px-1 pb-3">
            {detail}
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}
