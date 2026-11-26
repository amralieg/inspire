// REQ-526: one palette shape for the four designs (where each design keeps its page, card, text and accent tokens, plus its chart colours).
// Shared by the PowerPoint deck and the no-value infographic.
export function paletteOf(id, th) {
  switch (id) {
    case 'original': return { coverBg: th.tealDark, coverInk: th.heroInk, coverMuted: th.heroMuted, coverAccent: th.goldText, page: th.page, card: th.sand, ink: th.ink, body: th.body, muted: th.muted, accent: th.teal, accentText: th.coralText, warm: th.gold, rule: th.line, track: th.barTrack, kicker: th.coralText, rings: true, cats: [th.teal, th.gold, th.coral, th.tealMid, th.green] };
    case 'editorial_ink': return { coverBg: th.paper, coverInk: th.ink, coverMuted: th.grey, coverAccent: th.accentText, page: th.paper, card: th.quad, ink: th.ink, body: th.body, muted: th.grey, accent: th.accent, accentText: th.accentText, warm: th.tones[4], rule: th.rule, track: th.hair, kicker: th.accentText, masthead: true, cats: [th.tones[0], th.tones[1], th.tones[3], th.tones[5], th.tones[7]] };
    case 'bold': return { coverBg: th.hero, coverInk: th.heroInk, coverMuted: th.heroMuted, coverAccent: th.heroAccent, page: th.canvas, card: th.card, ink: th.ink, body: th.ink, muted: th.muted, accent: '#2272B4', accentText: th.accentText, warm: th.heroAccent, rule: th.grid, track: th.track, kicker: th.accentText, chips: true, cats: ['#FF3621', '#2272B4', '#00A972', '#FFAB00', '#7B52C9'] };
    default: return { coverBg: th.page, coverInk: th.ink, coverMuted: th.slate, coverAccent: th.blueText, page: th.page, card: th.panel, ink: th.ink, body: th.ink, muted: th.slate, accent: th.blue, accentText: th.blueText, warm: th.green, rule: th.rule, track: th.pale, kicker: th.blueText, edge: th.navy, cats: [th.blue, th.navy, th.green, ...th.funnel.slice(2)] };
  }
}
