import React from 'react';

/*
 * <AgentConstellation> — the agent, drawn.
 *
 * Rendered in the genesis field the moment Suggest returns: a
 * deterministic radial "second brain" view of what is being
 * assembled, inspired by the orbital dashboards of the second-brain
 * scene but mapped to OUR typed composition instead of raw files:
 *
 *      core        the agent's identity (emoji + name)
 *      BRAIN       the chosen connection + model (inner orange ring)
 *      SKILLS      selected packs as angular segments of glowing
 *                  dot-arcs — one hue per pack, one dot per leaf
 *                  skill (meta-packs bloom into their real trees)
 *      TOOLS       MCP servers as hex satellites
 *      KNOWLEDGE   knowledge bases as ringed moons
 *      TEAM        the gateway and its existing crew, outermost
 *
 * Pure inline SVG + CSS animation. Deterministic layout (no force
 * wobble): the same agent always draws the same constellation, so
 * over time people learn to READ agents at a glance. Respects
 * prefers-reduced-motion.
 */

export interface ConstellationSkill {
  pack: string;
  hue: number; // degrees
  skills: string[]; // leaf skill names (>=1; pack itself if none)
}

export interface ConstellationProps {
  emoji: string;
  name: string;
  brainLabel: string; // e.g. "Claude Sonnet 5"
  brainSub?: string; // e.g. "Claude — Red Hat Vertex"
  skills: ConstellationSkill[];
  tools: string[];
  knowledge: string[];
  team?: { gateway: string; members: string[]; isNew: boolean };
}

const W = 640;
const C = W / 2;

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
};

const PACK_HUES = [265, 320, 190, 48, 138, 20, 288, 210];

export const packHue = (idx: number) => PACK_HUES[idx % PACK_HUES.length];

/** Dot-arc: rows of dots filling an angular segment between two radii. */
const dotArc = (
  key: string,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  count: number,
  hue: number,
) => {
  const dots: React.ReactNode[] = [];
  const rows = Math.max(2, Math.min(6, Math.ceil(count / 9)));
  let placed = 0;
  for (let row = 0; row < rows && placed < 200; row++) {
    const r = r0 + ((r1 - r0) * (row + 0.5)) / rows;
    const span = a1 - a0;
    const per = Math.max(3, Math.round((span / 360) * (r / 2.2)));
    for (let i = 0; i < per; i++) {
      const deg = a0 + (span * (i + 0.5)) / per;
      const { x, y } = polar(r, deg);
      const big = placed < count;
      dots.push(
        <circle
          key={`${key}-${row}-${i}`}
          cx={x}
          cy={y}
          r={big ? 2.4 : 1.1}
          fill={`hsl(${hue} 85% ${big ? 72 : 38}%)`}
          opacity={big ? 0.95 : 0.35}
        />,
      );
      placed++;
    }
  }
  return dots;
};

const RingLabel: React.FC<{ r: number; text: string; hue: number; id: string }> = ({
  r,
  text,
  hue,
  id,
}) => (
  <>
    <defs>
      <path id={id} d={`M ${C - r} ${C} A ${r} ${r} 0 0 1 ${C + r} ${C}`} />
    </defs>
    <text
      fontSize={13}
      fontWeight={700}
      letterSpacing={4}
      fill={`hsl(${hue} 80% 70%)`}
      opacity={0.9}
    >
      <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
        {text}
      </textPath>
    </text>
  </>
);

export const AgentConstellation: React.FC<ConstellationProps> = ({
  emoji,
  name,
  brainLabel,
  brainSub,
  skills,
  tools,
  knowledge,
  team,
}) => {
  const skillCount = skills.reduce((n, s) => n + s.skills.length, 0);

  // Angular layout for skill segments (gap between each).
  const segs: { s: ConstellationSkill; a0: number; a1: number }[] = [];
  if (skills.length) {
    const gap = 14;
    const span = (360 - gap * skills.length) / skills.length;
    let a = -90 + gap / 2; // start at top
    for (const s of skills) {
      const width = span * Math.max(0.6, Math.min(2, s.skills.length / (skillCount / skills.length || 1)));
      segs.push({ s, a0: a, a1: a + span });
      a += span + gap;
      void width;
    }
  }

  const toolNodes = tools.slice(0, 14);
  const kbNodes = knowledge.slice(0, 10);
  const crew = team?.members?.slice(0, 8) ?? [];

  return (
    <div
      style={{
        background: 'radial-gradient(ellipse at center, #17142b 0%, #0b0a14 70%)',
        borderRadius: 12,
        padding: 8,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes aoc-spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        @keyframes aoc-spin-r { from { transform: rotate(0deg);} to { transform: rotate(-360deg);} }
        @keyframes aoc-pulse { 0%,100% { opacity: .55;} 50% { opacity: 1;} }
        .aoc-slow { animation: aoc-spin 240s linear infinite; transform-origin: ${C}px ${C}px; }
        .aoc-slower { animation: aoc-spin-r 360s linear infinite; transform-origin: ${C}px ${C}px; }
        .aoc-core { animation: aoc-pulse 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .aoc-slow, .aoc-slower, .aoc-core { animation: none; }
        }
      `}</style>
      <svg viewBox={`0 0 ${W} ${W}`} style={{ width: '100%', maxHeight: 560, display: 'block' }}>
        <defs>
          <filter id="aoc-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="aoc-hex" width="26" height="22" patternUnits="userSpaceOnUse">
            <path
              d="M6.5 0 L19.5 0 L26 11 L19.5 22 L6.5 22 L0 11 Z"
              fill="none"
              stroke="#2a2545"
              strokeWidth="0.5"
              opacity="0.5"
            />
          </pattern>
        </defs>

        <circle cx={C} cy={C} r={300} fill="url(#aoc-hex)" opacity={0.5} />

        {/* TEAM — outermost */}
        <g className="aoc-slower">
          <circle cx={C} cy={C} r={288} fill="none" stroke="hsl(210 70% 55%)" strokeWidth={1} opacity={0.5} strokeDasharray="1 6" />
          {crew.map((m, i) => {
            const { x, y } = polar(288, (360 / Math.max(crew.length, 1)) * i + 18);
            return (
              <g key={`crew-${m}`} filter="url(#aoc-glow)">
                <path
                  d={`M ${x - 11} ${y} l 5.5 -9.5 h 11 l 5.5 9.5 l -5.5 9.5 h -11 Z`}
                  fill="#101426"
                  stroke="hsl(210 80% 62%)"
                  strokeWidth={1.4}
                />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={9} fill="hsl(210 80% 78%)">
                  {m.slice(0, 2).toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
        {team && (
          <text x={C} y={C - 296} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing={4} fill="hsl(210 80% 70%)">
            TEAM · {team.gateway.toUpperCase()}
            {team.isNew ? ' (NEW)' : ''}
          </text>
        )}

        {/* KNOWLEDGE */}
        <circle cx={C} cy={C} r={248} fill="none" stroke="hsl(160 60% 45%)" strokeWidth={0.8} opacity={0.4} />
        <RingLabel r={252} text={kbNodes.length ? 'KNOWLEDGE' : ''} hue={160} id="aoc-kb-ring" />
        {kbNodes.map((k, i) => {
          const { x, y } = polar(248, (360 / Math.max(kbNodes.length, 1)) * i + 45);
          return (
            <g key={`kb-${k}`} filter="url(#aoc-glow)">
              <circle cx={x} cy={y} r={9} fill="#0d1a16" stroke="hsl(160 75% 55%)" strokeWidth={1.4} />
              <circle cx={x} cy={y} r={13} fill="none" stroke="hsl(160 75% 55%)" strokeWidth={0.6} opacity={0.5} />
              <text x={x} y={y + 3.5} textAnchor="middle" fontSize={8.5} fill="hsl(160 75% 75%)">
                {k.slice(0, 2).toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* TOOLS */}
        <g className="aoc-slow">
          <circle cx={C} cy={C} r={208} fill="none" stroke="hsl(28 80% 55%)" strokeWidth={0.8} opacity={0.35} strokeDasharray="2 5" />
          {toolNodes.map((t, i) => {
            const { x, y } = polar(208, (360 / Math.max(toolNodes.length, 1)) * i);
            return (
              <g key={`tool-${t}`} filter="url(#aoc-glow)">
                <path
                  d={`M ${x - 10} ${y} l 5 -8.7 h 10 l 5 8.7 l -5 8.7 h -10 Z`}
                  fill="#161022"
                  stroke="hsl(28 90% 60%)"
                  strokeWidth={1.3}
                />
                <text x={x} y={y + 3.5} textAnchor="middle" fontSize={8.5} fill="hsl(28 90% 75%)">
                  {t.slice(0, 2).toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
        <RingLabel r={214} text={toolNodes.length ? 'TOOLS' : ''} hue={28} id="aoc-tool-ring" />

        {/* SKILLS — dot arcs per pack */}
        <RingLabel r={172} text={skills.length ? 'SKILLS' : ''} hue={280} id="aoc-skill-ring" />
        {segs.map(({ s, a0, a1 }) => (
          <g key={`seg-${s.pack}`}>
            {dotArc(`arc-${s.pack}`, a0, a1, 118, 166, s.skills.length * 3, s.hue)}
            {(() => {
              const mid = (a0 + a1) / 2;
              const { x, y } = polar(186, mid);
              return (
                <g filter="url(#aoc-glow)">
                  <circle cx={x} cy={y} r={7} fill={`hsl(${s.hue} 80% 60%)`} opacity={0.95} />
                  <text
                    x={x}
                    y={y - 12}
                    textAnchor="middle"
                    fontSize={9.5}
                    fontWeight={700}
                    letterSpacing={1}
                    fill={`hsl(${s.hue} 85% 78%)`}
                  >
                    {s.pack.toUpperCase().slice(0, 18)}
                  </text>
                  <text x={x} y={y + 20} textAnchor="middle" fontSize={8} fill={`hsl(${s.hue} 60% 65%)`}>
                    {s.skills.length}
                  </text>
                </g>
              );
            })()}
          </g>
        ))}

        {/* BRAIN — inner double ring of diamonds */}
        <g className="aoc-slow">
          {[86, 74].map((r, ringIdx) =>
            Array.from({ length: ringIdx === 0 ? 28 : 20 }, (_, i) => {
              const { x, y } = polar(r, (360 / (ringIdx === 0 ? 28 : 20)) * i);
              return (
                <rect
                  key={`br-${r}-${i}`}
                  x={x - 2.6}
                  y={y - 2.6}
                  width={5.2}
                  height={5.2}
                  transform={`rotate(45 ${x} ${y})`}
                  fill="hsl(18 95% 58%)"
                  opacity={0.9}
                />
              );
            }),
          )}
        </g>
        <RingLabel r={98} text="BRAIN" hue={18} id="aoc-brain-ring" />

        {/* core */}
        <g filter="url(#aoc-glow)">
          <circle className="aoc-core" cx={C} cy={C} r={30} fill="#1c1428" stroke="hsl(30 90% 60%)" strokeWidth={1.6} />
          <text x={C} y={C + 7} textAnchor="middle" fontSize={22}>
            {emoji || '🤖'}
          </text>
        </g>
        <text x={C} y={C + 48} textAnchor="middle" fontSize={13} fontWeight={700} letterSpacing={2} fill="#f2ecff">
          {(name || 'AGENT').toUpperCase()}
        </text>
        <text x={C} y={C + 63} textAnchor="middle" fontSize={9.5} fill="hsl(18 90% 72%)">
          {brainLabel}
        </text>
        {brainSub && (
          <text x={C} y={C + 76} textAnchor="middle" fontSize={8.5} fill="#8f86ad">
            {brainSub}
          </text>
        )}
      </svg>
    </div>
  );
};

export default AgentConstellation;
