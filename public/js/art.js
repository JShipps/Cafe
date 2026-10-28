// Simple line illustrations used as placeholders for menu photography.
const stroke = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const ART = {
  coffee: {
    bg: 'linear-gradient(135deg, #7a5240, #3d281d)',
    svg: `<svg viewBox="0 0 64 64" ${stroke}><path d="M12 24h34v14a14 14 0 0 1-14 14h-6a14 14 0 0 1-14-14z"/><path d="M46 28h4a6 6 0 0 1 0 12h-5"/><path d="M22 8c0 4 4 4 4 8M32 8c0 4 4 4 4 8"/></svg>`,
  },
  tea: {
    bg: 'linear-gradient(135deg, #8aa585, #4f6b4a)',
    svg: `<svg viewBox="0 0 64 64" ${stroke}><path d="M10 26h36v8a18 18 0 0 1-36 0z"/><path d="M46 30h4a5 5 0 0 1 0 10h-6"/><path d="M28 26V12l6 4"/><path d="M14 56h28"/></svg>`,
  },
  bakery: {
    bg: 'linear-gradient(135deg, #e4b27e, #c8743f)',
    svg: `<svg viewBox="0 0 64 64" ${stroke}><path d="M6 40c4-12 14-20 26-20s22 8 26 20c-6 4-14 4-18 0-4 4-12 4-16 0-4 4-12 4-18 0z"/><path d="M22 24l4 12M32 20v16M42 24l-4 12"/></svg>`,
  },
  bread: {
    bg: 'linear-gradient(135deg, #c99a66, #8a5a33)',
    svg: `<svg viewBox="0 0 64 64" ${stroke}><path d="M8 36c0-12 10-20 24-20s24 8 24 20v6a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z"/><path d="M20 26l6 8M30 23l6 10M40 25l5 8"/></svg>`,
  },
  lunch: {
    bg: 'linear-gradient(135deg, #b8a46a, #6f6a3d)',
    svg: `<svg viewBox="0 0 64 64" ${stroke}><path d="M8 30h48"/><path d="M10 30c0-10 10-16 22-16s22 6 22 16"/><path d="M8 36c6 4 10-2 16 2s10-2 16 2 10-2 16 0"/><path d="M10 42h44v4a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z"/></svg>`,
  },
  sweets: {
    bg: 'linear-gradient(135deg, #d98f84, #9a4a4a)',
    svg: `<svg viewBox="0 0 64 64" ${stroke}><path d="M10 34h44v18H10z"/><path d="M10 42c6 4 10-4 16 0s10-4 16 0 8-2 12 0"/><path d="M14 34c0-8 8-12 18-12s18 4 18 12"/><path d="M32 22v-8"/><circle cx="32" cy="11" r="3"/></svg>`,
  },
};

export const categoryArt = (slug) => ART[slug] ?? ART.bakery;
