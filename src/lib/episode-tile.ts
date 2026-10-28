// A stand-in for episodes without artwork: the series' icon and name, drawn as a small tile.
// Used by the episodes list (poster-sized) and the home page's New on Patreon (icon-sized).
import type { Kind } from './types';

// 24×24 stroked paths.
export const TILE_ICONS = {
	mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7l8.5 6 8.5-6',
	popcorn: 'M5 9h14l-1.6 12H6.6zM9.7 9l.4 12M14.3 9l-.4 12M6 9a2.5 2.5 0 0 1 2.8-3.6 3.3 3.3 0 0 1 6.4 0A2.5 2.5 0 0 1 18 9',
	trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4',
	delta: 'M12 3l6.5 18L12 16l-6.5 5z',
	calendar: 'M4 6h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 11h18M8 3.5v4M16 3.5v4',
	// Film Junk's own: a popcorn bucket with "FJ" on it (the letters are added in the markup).
	fj: 'M5 9h14l-1.6 12H6.6zM6 9a2.5 2.5 0 0 1 2.8-3.6 3.3 3.3 0 0 1 6.4 0A2.5 2.5 0 0 1 18 9',
};
export type TileIcon = keyof typeof TILE_ICONS;

// The series an episode belongs to, from its title: [icon, name].
export function episodeTile(title: string, kind: Kind): [TileIcon, string] {
	if (/junk mail/i.test(title)) return ['mail', 'Junk Mail'];
	if (/what we watched/i.test(title)) return ['popcorn', 'What We Watched'];
	if (/treknobabble/i.test(title)) return ['delta', 'Star Trek'];
	if (/calendar reveal/i.test(title)) return ['calendar', 'Calendar'];
	if (/\btop \d+|tier ranking|junkies/i.test(title)) return ['trophy', 'Lists'];
	return ['fj', { premium: 'Premium', patreon: 'Patreon', bonus: 'Bonus', regular: 'Film Junk' }[kind]];
}
