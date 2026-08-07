/**
 * Chat wallpapers.
 *
 * The client owns this catalogue and the server only ever stores an ID (see
 * `setChatTheme`) — a client that could persist arbitrary CSS for other
 * surfaces to render is a style-injection hole, and IDs close it. It also means
 * a wallpaper can be restyled or made theme-aware later without migrating
 * anyone's saved preference.
 *
 * Every preset is defined for BOTH themes. A wallpaper that looks right on the
 * pale-mint canvas and turns into a glare on the navy one is worse than none.
 */

/** SVG pattern → data URI, sized so it tiles without visible seams. */
const svg = (body, size = 40) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>${body}</svg>`
  )}")`;

const dots = (color) => svg(`<circle cx='2' cy='2' r='1.5' fill='${color}'/>`, 22);
const grid = (color) => svg(`<path d='M40 0H0V40' fill='none' stroke='${color}' stroke-width='1'/>`, 40);
const waves = (color) =>
  svg(`<path d='M0 20 Q 15 8 30 20 T 60 20' fill='none' stroke='${color}' stroke-width='1.5'/>`, 60);
const cross = (color) =>
  svg(`<path d='M14 10v8M10 14h8' stroke='${color}' stroke-width='1.5' stroke-linecap='round'/>`, 28);

/**
 * `light` / `dark` are plain React style objects applied to the message area.
 * Keeping them as data (not classes) lets a preset combine a base colour, a
 * gradient and a pattern in one layer stack, which Tailwind can't express.
 */
export const WALLPAPERS = [
  {
    id: '',
    name: 'Default',
    swatch: 'bg-surface-2',
    light: {},
    dark: {},
  },
  {
    id: 'mint',
    name: 'Mint',
    swatch: 'bg-mint-100',
    light: { backgroundColor: '#e8f4ee' },
    dark: { backgroundColor: '#0a2338' },
  },
  {
    id: 'paper',
    name: 'Paper',
    swatch: 'bg-[#f3efe7]',
    light: { backgroundColor: '#f3efe7' },
    dark: { backgroundColor: '#14202b' },
  },
  {
    id: 'ink',
    name: 'Ink',
    swatch: 'bg-navy-900',
    light: { backgroundColor: '#dde7ef' },
    dark: { backgroundColor: '#061a2a' },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    swatch: 'bg-gradient-to-br from-mint-200 to-brand-500',
    light: { backgroundImage: 'linear-gradient(160deg,#e4f2ea 0%,#cfe8e3 55%,#b7dcd6 100%)' },
    dark: { backgroundImage: 'linear-gradient(160deg,#071a2b 0%,#0c2c47 55%,#123857 100%)' },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    swatch: 'bg-gradient-to-br from-violet-500 to-navy-900',
    light: { backgroundImage: 'linear-gradient(160deg,#eef1f7 0%,#dfe6f2 60%,#cdd8ea 100%)' },
    dark: { backgroundImage: 'linear-gradient(160deg,#0b1526 0%,#16233d 60%,#1e2b47 100%)' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatch: 'bg-gradient-to-br from-cyan-300 to-cyan-600',
    light: { backgroundImage: 'linear-gradient(160deg,#e6f5f6 0%,#cfeaec 60%,#b6dee1 100%)' },
    dark: { backgroundImage: 'linear-gradient(160deg,#06202b 0%,#0a3038 60%,#0e3f49 100%)' },
  },
  {
    id: 'dots',
    name: 'Dots',
    swatch: 'bg-surface-2',
    light: { backgroundColor: '#eef4f1', backgroundImage: dots('rgba(12,44,71,0.12)') },
    dark: { backgroundColor: '#08202f', backgroundImage: dots('rgba(228,242,234,0.10)') },
  },
  {
    id: 'grid',
    name: 'Grid',
    swatch: 'bg-surface-2',
    light: { backgroundColor: '#f1f6f3', backgroundImage: grid('rgba(12,44,71,0.07)') },
    dark: { backgroundColor: '#08202f', backgroundImage: grid('rgba(228,242,234,0.06)') },
  },
  {
    id: 'waves',
    name: 'Waves',
    swatch: 'bg-surface-2',
    light: { backgroundColor: '#eaf4ef', backgroundImage: waves('rgba(45,86,82,0.14)') },
    dark: { backgroundColor: '#08202f', backgroundImage: waves('rgba(151,211,205,0.12)') },
  },
  {
    id: 'doodle',
    name: 'Doodle',
    swatch: 'bg-surface-2',
    light: { backgroundColor: '#f2efe6', backgroundImage: cross('rgba(45,86,82,0.18)') },
    dark: { backgroundColor: '#0d2233', backgroundImage: cross('rgba(151,211,205,0.14)') },
  },
];

export const WALLPAPER_IDS = WALLPAPERS.map((w) => w.id);

/**
 * Resolve a wallpaper id to a style object for the current theme.
 * `chatWallpaper` wins over the account default; an unknown id falls back to
 * the plain surface rather than throwing or rendering nothing.
 */
export function wallpaperStyle(chatWallpaper, defaultWallpaper, dark) {
  const id = chatWallpaper || defaultWallpaper || '';
  if (!id) return null;
  const preset = WALLPAPERS.find((w) => w.id === id);
  if (!preset) return null;
  const style = dark ? preset.dark : preset.light;
  return Object.keys(style).length ? style : null;
}

export function wallpaperName(id) {
  return WALLPAPERS.find((w) => w.id === id)?.name || 'Default';
}
