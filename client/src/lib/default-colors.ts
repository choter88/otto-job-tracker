// Default color mappings from design_guidelines.md
// HSL values with corresponding hex colors for color pickers

export interface ColorDefinition {
  id: string;
  label: string;
  hsl: string;
  hex: string;
  order: number;
}

// Job Status Default Colors
export const DEFAULT_STATUS_COLORS: ColorDefinition[] = [
  {
    id: 'job_created',
    label: 'Job Created',
    hsl: '217 91% 60%',
    hex: '#1F7AEA',
    order: 1
  },
  {
    id: 'ordered',
    label: 'Ordered',
    hsl: '220 13% 60%',
    hex: '#8B95A1',
    order: 2
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    hsl: '38 92% 50%',
    hex: '#F59E0B',
    order: 3
  },
  {
    id: 'quality_check',
    label: 'Quality Check',
    hsl: '283 39% 53%',
    hex: '#A855F7',
    order: 4
  },
  {
    id: 'ready_for_pickup',
    label: 'Ready for Pickup',
    hsl: '142 76% 36%',
    hex: '#16A34A',
    order: 5
  },
  {
    id: 'completed',
    label: 'Completed',
    hsl: '262 83% 58%',
    hex: '#8B5CF6',
    order: 6
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    hsl: '0 84% 60%',
    hex: '#EF4444',
    order: 7
  }
];

// Job Type Default Colors
export const DEFAULT_JOB_TYPE_COLORS: ColorDefinition[] = [
  {
    id: 'contacts',
    label: 'Contacts',
    hsl: '220 13% 60%',
    hex: '#8B95A1',
    order: 1
  },
  {
    id: 'glasses',
    label: 'Glasses',
    hsl: '199 89% 48%',
    hex: '#0EA5E9',
    order: 2
  },
  {
    id: 'sunglasses',
    label: 'Sunglasses',
    hsl: '38 92% 50%',
    hex: '#F59E0B',
    order: 3
  },
  {
    id: 'prescription',
    label: 'Prescription',
    hsl: '283 39% 53%',
    hex: '#A855F7',
    order: 4
  }
];

// Destination Default Colors
export const DEFAULT_DESTINATION_COLORS: ColorDefinition[] = [
  {
    id: 'vision_lab',
    label: 'Vision Lab',
    hsl: '220 60% 88%',
    hex: '#E0E7FF',
    order: 1
  },
  {
    id: 'eyetech_labs',
    label: 'EyeTech Labs',
    hsl: '142 76% 88%',
    hex: '#D1FAE5',
    order: 2
  },
  {
    id: 'premium_optics',
    label: 'Premium Optics',
    hsl: '45 100% 88%',
    hex: '#FEF3C7',
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

// Helper to get color for badge styling
export function getColorForBadge(color: string): { background: string; text: string } {
  // If it's already in HSL format (from our defaults)
  if (color.includes('%')) {
    return {
      background: `hsl(${color} / 0.15)`,
      text: `hsl(${color})`
    };
  }
  
  // If it's hex, convert to HSL and apply
  const hsl = hexToHSL(color);
  return {
    background: `hsl(${hsl} / 0.15)`,
    text: `hsl(${hsl})`
  };
}
