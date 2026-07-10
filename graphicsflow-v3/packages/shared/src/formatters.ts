function normalizeIdentifier(value: string | number | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function formatPrefixedIdentifier(
  value: string | number | null | undefined,
  prefix: string,
  acceptedPrefixes: readonly string[] = [prefix],
): string {
  const normalized = normalizeIdentifier(value);

  if (!normalized) return '—';

  for (const acceptedPrefix of acceptedPrefixes) {
    const normalizedPrefix = acceptedPrefix.toUpperCase();

    if (normalized.startsWith(normalizedPrefix)) {
      const remainder = normalized.slice(normalizedPrefix.length).replace(/^#+/, '');
      return remainder ? `${prefix}${remainder}` : prefix;
    }
  }

  const unprefixed = normalized.replace(/^#+/, '');
  return unprefixed ? `${prefix}${unprefixed}` : '—';
}

export function formatGNumber(value: string | number | null | undefined): string {
  return formatPrefixedIdentifier(value, 'G#', ['G#', 'G']);
}

/**
 * GraphicsFlow V3 uses S# as the user-facing label for specification numbers.
 * Legacy F# values are normalized to S# without requiring an immediate database migration.
 */
export function formatSpecNumber(value: string | number | null | undefined): string {
  return formatPrefixedIdentifier(value, 'S#', ['S#', 'F#', 'S', 'F']);
}

export function formatDNumber(value: string | number | null | undefined): string {
  return formatPrefixedIdentifier(value, 'D#', ['D#', 'D']);
}

export function formatRevision(value: string | number | null | undefined): string {
  const normalized = normalizeIdentifier(value);
  return normalized ? `REV ${normalized.replace(/^REV\s*/i, '')}` : '—';
}
