interface ScreensaverArt {
  title: string;
  backgroundImage: string;
}

const variants = [
  ["Moonlit demitasse", "#102326", "#5bd179", "cup"],
  ["Tiny espresso planet", "#1a1625", "#77d1c2", "planet"],
  ["Midnight tamper", "#181d24", "#f0c36a", "tamper"],
  ["Sleepy portafilter", "#0f1d22", "#8aa8ff", "portafilter"],
  ["Bean constellation", "#151722", "#c08b5c", "beans"],
  ["Dark crema wave", "#111a1f", "#d49b6a", "wave"],
  ["Little brew moon", "#101820", "#6fcf97", "moon"],
  ["Quiet kettle", "#161923", "#78c6c8", "kettle"],
  ["Night grinder", "#141b20", "#b4a7ff", "grinder"],
  ["Starry puck", "#111721", "#c6a16b", "puck"],
  ["Low light latte", "#17171f", "#e0b982", "latte"],
  ["Cosmic scale", "#121b22", "#73d3b6", "scale"],
  ["Resting dripper", "#121722", "#9fb7ff", "dripper"],
  ["Tiny roast cloud", "#161a1c", "#cc8d64", "cloud"],
  ["Night shot", "#10191d", "#7ee0c3", "shot"]
] as const;

function bean(x: number, y: number, rotate: number, color: string): string {
  return `<g transform="translate(${x} ${y}) rotate(${rotate})"><ellipse cx="0" cy="0" rx="10" ry="17" fill="${color}" opacity=".78"/><path d="M-2 -13c6 7 6 18-1 26" fill="none" stroke="#090d10" stroke-width="2" opacity=".65"/></g>`;
}

function icon(kind: string, accent: string): string {
  if (kind === "planet") return `<circle cx="160" cy="92" r="42" fill="${accent}" opacity=".2"/><ellipse cx="160" cy="92" rx="76" ry="20" fill="none" stroke="${accent}" stroke-width="5" opacity=".65"/>`;
  if (kind === "tamper") return `<rect x="137" y="48" width="46" height="52" rx="18" fill="${accent}" opacity=".32"/><rect x="112" y="104" width="96" height="28" rx="10" fill="${accent}" opacity=".55"/>`;
  if (kind === "portafilter") return `<path d="M100 88h82a28 28 0 0 1 0 56h-82z" fill="${accent}" opacity=".34"/><path d="M182 110h78" stroke="${accent}" stroke-width="16" stroke-linecap="round" opacity=".5"/>`;
  if (kind === "beans") return `${bean(120, 78, -28, accent)}${bean(170, 116, 18, accent)}${bean(216, 76, 38, accent)}`;
  if (kind === "wave") return `<path d="M62 122c36-34 68 34 104 0s68 34 104 0" fill="none" stroke="${accent}" stroke-width="11" stroke-linecap="round" opacity=".6"/>`;
  if (kind === "moon") return `<path d="M179 54a52 52 0 1 0 0 104a42 42 0 1 1 0-104z" fill="${accent}" opacity=".38"/>`;
  if (kind === "kettle") return `<path d="M104 88h92l-10 58h-72z" fill="${accent}" opacity=".3"/><path d="M196 100c40 4 44 42 0 46" fill="none" stroke="${accent}" stroke-width="9" opacity=".5"/>`;
  if (kind === "grinder") return `<rect x="122" y="46" width="76" height="86" rx="14" fill="${accent}" opacity=".28"/><circle cx="160" cy="94" r="22" fill="none" stroke="${accent}" stroke-width="8" opacity=".62"/>`;
  if (kind === "puck") return `<ellipse cx="160" cy="94" rx="76" ry="30" fill="${accent}" opacity=".2"/><ellipse cx="160" cy="112" rx="76" ry="30" fill="${accent}" opacity=".38"/>`;
  if (kind === "latte") return `<path d="M96 78h128l-14 72h-100z" fill="${accent}" opacity=".25"/><path d="M132 104c14-18 42-18 56 0c-14 18-42 18-56 0z" fill="${accent}" opacity=".62"/>`;
  if (kind === "scale") return `<rect x="90" y="104" width="140" height="42" rx="14" fill="${accent}" opacity=".26"/><circle cx="160" cy="124" r="14" fill="none" stroke="${accent}" stroke-width="6" opacity=".68"/>`;
  if (kind === "dripper") return `<path d="M104 62h112l-30 72h-52z" fill="${accent}" opacity=".28"/><path d="M128 146h64" stroke="${accent}" stroke-width="10" stroke-linecap="round" opacity=".55"/>`;
  if (kind === "cloud") return `<path d="M92 116c0-21 21-34 40-25c11-22 47-22 58 2c22-2 38 11 38 30c0 18-15 29-35 29h-67c-20 0-34-14-34-36z" fill="${accent}" opacity=".3"/>`;
  if (kind === "shot") return `<path d="M112 54h96l-12 104h-72z" fill="${accent}" opacity=".22"/><path d="M132 84h56" stroke="${accent}" stroke-width="12" stroke-linecap="round" opacity=".58"/>`;
  return `<path d="M104 72h92v54a40 40 0 0 1-40 40h-12a40 40 0 0 1-40-40z" fill="${accent}" opacity=".32"/><path d="M196 92h20a24 24 0 0 1 0 48h-20" fill="none" stroke="${accent}" stroke-width="8" opacity=".6"/>`;
}

function makeArt([title, base, accent, kind]: (typeof variants)[number]): ScreensaverArt {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 210"><rect width="320" height="210" fill="${base}"/><path d="M0 164c54-28 97-22 139-3s93 27 181-14v63H0z" fill="#050708" opacity=".46"/><g opacity=".65">${icon(kind, accent)}</g>${bean(58, 52, -24, accent)}${bean(262, 154, 29, accent)}<circle cx="254" cy="44" r="2" fill="${accent}" opacity=".6"/><circle cx="72" cy="166" r="2" fill="${accent}" opacity=".45"/></svg>`;
  return {
    title,
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  };
}

export const screensaverArt: ScreensaverArt[] = variants.map(makeArt);
