/**
 * Presentation-only initials for avatars and workspace badges. Deriving them
 * keeps initials out of the data model: the session carries the account's own
 * avatarInitials, and everything else — organizations, client companies — is
 * derived from its name here.
 */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
