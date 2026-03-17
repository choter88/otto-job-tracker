// Default color mappings from design_guidelines.md
// HSL values with corresponding hex colors for color pickers

export interface ColorDefinition {
  id: string;
  label: string;
  hsl: string;
  hex: string;
  order: number;
}

export const HIGH_CONTRAST_COLOR_PALETTE = [
  "#2563EB", // blue-600
  "#4F46E5", // indigo-600
  "#7C3AED", // violet-600
  "#C026D3", // fuchsia-600
  "#DB2777", // pink-600
  "#E11D48", // rose-600
  "#DC2626", // red-600
  "#EA580C", // orange-600
  "#D97706", // amber-600
  "#16A34A", // green-600
  "#059669", // emerald-600
  "#0D9488", // teal-600
  "#0284C7", // sky-600
  "#475569", // slate-600
];

function normalizeHexColor(value: string) {
  return value.trim().toLowerCase();
}

export function chooseHighContrastColor(existingColors: string[]) {
  const normalizedExisting = existingColors
    .map(normalizeHexColor)
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const color of normalizedExisting) {
    counts.set(color, (counts.get(color) || 0) + 1);
  }

  const unused = HIGH_CONTRAST_COLOR_PALETTE.filter(
    (color) => !counts.has(normalizeHexColor(color)),
  );

  const candidates =
    unused.length > 0
      ? unused
      : (() => {
          // Palette exhausted. Pick from the least-used colors to reduce duplication.
          let minCount = Infinity;
          for (const color of HIGH_CONTRAST_COLOR_PALETTE) {
            minCount = Math.min(minCount, counts.get(normalizeHexColor(color)) || 0);
          }

          return HIGH_CONTRAST_COLOR_PALETTE.filter(
            (color) => (counts.get(normalizeHexColor(color)) || 0) === minCount,
          );
        })();

  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Job Status Default Colors
export const DEFAULT_STATUS_COLORS: ColorDefinition[] = [
  {
    id: 'job_created',
    label: 'Job Created',
    hsl: hexToHSL('#2563EB'),
    hex: '#2563EB',
    order: 1
  },
  {
    id: 'ordered',
    label: 'Ordered',
    hsl: hexToHSL('#D97706'),
    hex: '#D97706',
    order: 2
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    hsl: hexToHSL('#0284C7'),
    hex: '#0284C7',
    order: 3
  },
  {
    id: 'quality_check',
    label: 'Quality Check',
    hsl: hexToHSL('#7C3AED'),
    hex: '#7C3AED',
    order: 4
  },
  {
    id: 'ready_for_pickup',
    label: 'Ready for Pickup',
    hsl: hexToHSL('#16A34A'),
    hex: '#16A34A',
    order: 5
  },
  {
    id: 'completed',
    label: 'Completed',
    hsl: hexToHSL('#059669'),
    hex: '#059669',
    order: 6
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    hsl: hexToHSL('#DC2626'),
    hex: '#DC2626',
    order: 7
  }
];

// Job Type Default Colors
export const DEFAULT_JOB_TYPE_COLORS: ColorDefinition[] = [
  {
    id: 'contacts',
    label: 'Contacts',
    hsl: hexToHSL('#475569'),
    hex: '#475569',
    order: 1
  },
  {
    id: 'glasses',
    label: 'Glasses',
    hsl: hexToHSL('#2563EB'),
    hex: '#2563EB',
    order: 2
  },
  {
    id: 'sunglasses',
    label: 'Sunglasses',
    hsl: hexToHSL('#D97706'),
    hex: '#D97706',
    order: 3
  },
  {
    id: 'prescription',
    label: 'Prescription',
    hsl: hexToHSL('#7C3AED'),
    hex: '#7C3AED',
    order: 4
  }
];

// Destination Default Colors
export const DEFAULT_DESTINATION_COLORS: ColorDefinition[] = [
  {
    id: 'vision_lab',
    label: 'Vision Lab',
    hsl: hexToHSL('#0284C7'),
    hex: '#0284C7',
    order: 1
  },
  {
    id: 'eyetech_labs',
    label: 'EyeTech Labs',
    hsl: hexToHSL('#16A34A'),
    hex: '#16A34A',
    order: 2
  },
  {
    id: 'premium_optics',
    label: 'Premium Optics',
    hsl: hexToHSL('#D97706'),
    hex: '#D97706',
    order: 3
  }
];

// Helper function to get default color by ID
export function getDefaultStatusColor(statusId: string): ColorDefinition | undefined {
  return DEFAULT_STATUS_COLORS.find(c => c.id === statusId);
}

export function getDefaultJobTypeColor(typeId: string): ColorDefinition | undefined {
  return DEFAULT_JOB_TYPE_COLORS.find(c => c.id === typeId);
}

export function getDefaultDestinationColor(destinationLabel: string): ColorDefinition | undefined {
  return DEFAULT_DESTINATION_COLORS.find(c => c.label === destinationLabel);
}

// Helper to convert hex to HSL for display
export function hexToHSL(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '0 0% 50%';

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  return `${h} ${s}% ${l}%`;
}

// Helper to convert HSL string (e.g. "210 50% 60%") to hex
export function hslToHex(hslStr: string): string {
  const parts = hslStr.replace(/%/g, "").split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return "#808080";
  let [h, s, l] = parts;
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Normalize any color value to a hex string suitable for <input type="color">.
// Accepts hex (#rrggbb), HSL ("210 50% 60%"), or empty → fallback.
export function normalizeToHex(color: string | undefined, hsl: string | undefined, hex: string | undefined): string {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (color && /^#[0-9a-fA-F]{3}$/.test(color)) {
    // Expand shorthand #rgb → #rrggbb
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  if (hsl && hsl.includes("%")) return hslToHex(hsl);
  if (color && color.includes("%")) return hslToHex(color);
  return "#808080";
}

// Helper to get color for badge styling
export function getColorForBadge(color: string | null | undefined): { background: string; text: string } {
  const safeColor = typeof color === "string" ? color.trim() : "";
  if (!safeColor) {
    return { background: "hsl(0 0% 90% / 0.15)", text: "hsl(0 0% 40%)" };
  }

  // If it's already in HSL format (from our defaults)
  if (safeColor.includes('%')) {
    return {
      background: `hsl(${safeColor} / 0.15)`,
      text: `hsl(${safeColor})`
    };
  }
  
  // If it's hex, convert to HSL and apply
  const hsl = hexToHSL(safeColor);
  return {
    background: `hsl(${hsl} / 0.15)`,
    text: `hsl(${hsl})`
  };
}
