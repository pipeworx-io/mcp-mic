interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * MIC — ISO 10383 Market Identifier Code decoder (fleet #3261)
 *
 * Decodes the 4-character venue code openfigi returns as `exchCode` on a
 * security's exchange listing (and that most market-data feeds use the same
 * way) to the trading venue's own name, legal operator, country, city and
 * status, per ANNA's Market Identifier Code registry — the Registration
 * Authority for ISO 10383.
 *
 * SHAPE. ANNA publishes the registry as a downloadable file only (checked
 * live 2026-10-17: the registry's own listing page links straight to the
 * file; there is no query API, keyed or otherwise), so this pack answers
 * from a baked table rather than a live per-call fetch — the same "local
 * copy when live fails" shape as every other baked-index pack in this repo
 * (mcps/south-dakota-code is the worked example). The table is uploaded to
 * KV at deploy and injected by the gateway as `args._bakedIndex` on the
 * first call into this pack — see ensureIndex() below and
 * workers/gateway/src/pack-baked-indexes.json. Refresh path:
 * scripts/bake-index.mjs, re-run on a schedule (ANNA updates the registry on
 * an ongoing basis).
 *
 * Two MIC "kinds" (per ISO 10383 itself): an OPERATING MIC names the venue
 * operator as a whole (e.g. "XNYS", the New York Stock Exchange); a SEGMENT
 * MIC names one specific market/order book under that operator (e.g.
 * "ARCX", NYSE Arca, operates under XNYS). decode_mic reports which kind a
 * code is and, for an operating MIC, how many segments sit under it.
 *
 * Tools:
 * - decode_mic:   one MIC -> venue name, operator, country, city, status
 * - search_mics:  filter the registry by country, operator, status, name
 */
import type { MicRow } from './mic-index-data.js';

const tools: McpToolExport['tools'] = [
  {
    name: 'decode_mic',
    description:
      'Decode an ISO 10383 Market Identifier Code (MIC) — the 4-character venue code openfigi returns as `exchCode` ' +
      'on an exchange listing, and the code most market-data feeds use the same way — to the trading venue\'s own ' +
      'name, legal operator, country, city, website and registry status. Reports whether the code is an OPERATING ' +
      'MIC (the operator as a whole, e.g. "XNYS") or a SEGMENT MIC (one specific market under an operator, e.g. ' +
      '"ARCX" under "XNYS"); an operating MIC also carries segment_count — call search_mics with operating_mic to list them.',
    summary: 'The venue name, operator, country and status behind an ISO 10383 Market Identifier Code.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '4-character ISO 10383 MIC, e.g. "XNYS" (NYSE) or "XLON" (London Stock Exchange).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'search_mics',
    description:
      'Filter the ISO 10383 Market Identifier Code registry by country, operating MIC, status and/or a name fragment. ' +
      'Returns aggregate counts first (total matched, by_status, by_country) and a page of rows after. Use operating_mic ' +
      'to list every segment market under one venue operator (e.g. every segment under "XNYS").',
    summary: 'Trading venues in the ISO 10383 Market Identifier Code registry, filtered by country, operator, status or name.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of the venue, e.g. "US", "GB", "JP".' },
        operating_mic: { type: 'string', description: 'List every market (segment or operating) under this operating MIC, e.g. "XNYS" to list NYSE\'s own segments.' },
        status: { type: 'string', description: 'Registry status.', enum: ['ACTIVE', 'UPDATED', 'EXPIRED'] },
        name_contains: { type: 'string', description: 'Case-insensitive fragment of the market name, legal entity name or acronym, e.g. "nasdaq".' },
        limit: { type: 'number', description: 'Rows per page, 1-500 (default 50).' },
        offset: { type: 'number', description: 'Rows to skip for paging (default 0).' },
      },
    },
  },
];

// fleet #2754: a pack registered in pack-baked-indexes.json must never VALUE
// import its data module — the whole table would then be evaluated at
// module scope in every gateway isolate, including ones that never serve
// this pack. `MicRow` above is a type-only import (erased at build time);
// the actual rows arrive at runtime via args._bakedIndex, injected by the
// gateway from KV on the first call into this pack and adopted for the
// isolate's life.
let MIC_ROWS: MicRow[] = [];
let MIC_INDEX_CAPTURED_AT = '';

function ensureIndex(args: Record<string, unknown>): void {
  if (MIC_ROWS.length) return;
  const idx = args._bakedIndex as Record<string, unknown> | null | undefined;
  const rows = idx?.MIC_ROWS;
  const capturedAt = idx?.MIC_INDEX_CAPTURED_AT;
  if (!Array.isArray(rows) || rows.length === 0 || typeof capturedAt !== 'string') {
    // Loud on purpose: answering from an empty table would read as "no such
    // MIC" / "no match" — a silent wrong answer indistinguishable from a
    // real miss (docs/silent-zero-policy.md).
    throw new Error(
      `mic: the baked MIC index is unavailable (${idx == null ? 'not injected' : 'malformed'}). ` +
        'The gateway loads it from KV on the first call into this pack; this is a server-side fault, not an unknown code — retry shortly.',
    );
  }
  MIC_ROWS = rows as MicRow[];
  MIC_INDEX_CAPTURED_AT = capturedAt;
}

// Tuple field indices — see mic-index-data.ts's own header for the full list.
const F = {
  mic: 0, operatingMic: 1, type: 2, marketName: 3, legalEntityName: 4, lei: 5,
  marketCategoryCode: 6, acronym: 7, countryCode: 8, city: 9, website: 10,
  status: 11, creationDate: 12, lastUpdateDate: 13, lastValidationDate: 14,
  expiryDate: 15, comments: 16,
} as const;

function toRecord(r: MicRow) {
  return {
    mic: r[F.mic],
    operating_mic: r[F.operatingMic] || null,
    type: r[F.type] === 'OPRT' ? 'operating' : r[F.type] === 'SGMT' ? 'segment' : r[F.type] || null,
    market_name: r[F.marketName] || null,
    legal_entity_name: r[F.legalEntityName] || null,
    lei: r[F.lei] || null,
    market_category_code: r[F.marketCategoryCode] || null,
    acronym: r[F.acronym] || null,
    country_code: r[F.countryCode] || null,
    city: r[F.city] || null,
    website: r[F.website] || null,
    status: r[F.status] || null,
    creation_date: r[F.creationDate] || null,
    last_update_date: r[F.lastUpdateDate] || null,
    last_validation_date: r[F.lastValidationDate] || null,
    expiry_date: r[F.expiryDate] || null,
    comments: r[F.comments] || null,
  };
}

function decodeMic(args: Record<string, unknown>) {
  ensureIndex(args);
  const raw = args.code;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Required argument "code" is missing or empty. Pass a 4-character MIC like "XNYS" or "XLON".');
  }
  const code = raw.trim().toUpperCase();
  const row = MIC_ROWS.find((r) => r[F.mic] === code);
  if (!row) {
    throw new Error(
      `user_error: "${code}" is not a MIC in the ISO 10383 registry (${MIC_ROWS.length} codes, as of ${MIC_INDEX_CAPTURED_AT}). ` +
        'Verify the code, or use search_mics to browse by name or country rather than guessing one.',
    );
  }
  const decoded = toRecord(row);
  const segments =
    decoded.type === 'operating'
      ? MIC_ROWS.filter((r) => r[F.operatingMic] === code && r[F.mic] !== code)
      : [];
  return {
    found: true,
    data_as_of: MIC_INDEX_CAPTURED_AT,
    ...decoded,
    ...(decoded.type === 'operating'
      ? {
          segment_count: segments.length,
          ...(segments.length
            ? { note: `This is an operating MIC with ${segments.length} segment market(s) under it — call search_mics with operating_mic: "${code}" to list them.` }
            : {}),
        }
      : {}),
  };
}

function searchMics(args: Record<string, unknown>) {
  ensureIndex(args);
  const country = typeof args.country === 'string' && args.country.trim() ? args.country.trim().toUpperCase() : null;
  const operatingMic = typeof args.operating_mic === 'string' && args.operating_mic.trim() ? args.operating_mic.trim().toUpperCase() : null;
  const status = typeof args.status === 'string' && args.status.trim() ? args.status.trim().toUpperCase() : null;
  const nameContains = typeof args.name_contains === 'string' && args.name_contains.trim() ? args.name_contains.trim().toLowerCase() : null;
  const limit = Math.min(500, Math.max(1, Math.round((args.limit as number) ?? 50)));
  const offset = Math.max(0, Math.round((args.offset as number) ?? 0));

  if (status && status !== 'ACTIVE' && status !== 'UPDATED' && status !== 'EXPIRED') {
    throw new Error(`user_error: unknown status "${args.status}". Use ACTIVE, UPDATED or EXPIRED.`);
  }

  const filtersTried: string[] = [];
  if (country) filtersTried.push(`country=${country}`);
  if (operatingMic) filtersTried.push(`operating_mic=${operatingMic}`);
  if (status) filtersTried.push(`status=${status}`);
  if (nameContains) filtersTried.push(`name_contains="${nameContains}"`);

  const matched = MIC_ROWS.filter((r) => {
    if (country && r[F.countryCode] !== country) return false;
    if (operatingMic && r[F.operatingMic] !== operatingMic) return false;
    if (status && r[F.status] !== status) return false;
    if (nameContains) {
      const hay = `${r[F.marketName]} ${r[F.legalEntityName]} ${r[F.acronym]}`.toLowerCase();
      if (!hay.includes(nameContains)) return false;
    }
    return true;
  });

  const byStatus: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  for (const r of matched) {
    byStatus[r[F.status]] = (byStatus[r[F.status]] ?? 0) + 1;
    if (r[F.countryCode]) byCountry[r[F.countryCode]] = (byCountry[r[F.countryCode]] ?? 0) + 1;
  }

  const page = matched.slice(offset, offset + limit).map(toRecord);

  return {
    found: matched.length > 0,
    data_as_of: MIC_INDEX_CAPTURED_AT,
    total: matched.length,
    by_status: byStatus,
    by_country: byCountry,
    returned: page.length,
    offset,
    ...(offset + page.length < matched.length ? { next_offset: offset + page.length } : {}),
    ...(matched.length === 0
      ? {
          note: filtersTried.length
            ? `No MIC in the registry (${MIC_ROWS.length} codes, as of ${MIC_INDEX_CAPTURED_AT}) matches: ${filtersTried.join(', ')}. That is a real zero, not an error.`
            : `No filters were given and the registry is unexpectedly empty — this should never happen; treat as a server fault.`,
        }
      : {}),
    rows: page,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'decode_mic':
      return decodeMic(args);
    case 'search_mics':
      return searchMics(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool } satisfies McpToolExport;
