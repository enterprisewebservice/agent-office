import React from 'react';

/*
 * <AgentConstellation> — the agent, drawn, and now INTERROGABLE.
 *
 * A deterministic radial "second brain" view of the agent being
 * assembled. Every element is clickable and drives a drill-in panel:
 *
 *      core        identity (name, role, system prompt preview)
 *      BRAIN       connection + model, with the full model menu
 *      SKILLS      per-pack glowing dot-arcs; drill shows the real
 *                  tree (packs → leaf skills, installed state),
 *                  unmet prerequisites, requires-graph, and Remove
 *      TOOLS       MCP hexes; drill shows url + contributing pack
 *      KNOWLEDGE   KB moons; drill shows role + contributor
 *      TEAM        gateway + crew; drill shows placement reasoning
 *
 * Deterministic layout on purpose (same agent ⇒ same constellation)
 * so people learn to read agents at a glance. Pure inline SVG + CSS,
 * honors prefers-reduced-motion.
 */

export interface ConstellationTree {
  pack: string;
  skills: { name: string; installed?: boolean }[];
}

export interface ConstellationSkill {
  name: string;
  displayName?: string;
  hue: number;
  version?: string;
  artifactKind?: string;
  reason?: string;
  installed?: boolean;
  registry?: string;
  leaves: string[];
  tree: ConstellationTree[];
  unmet: { name: string; kind: string }[];
  requires: { name: string; range?: string; satisfied: boolean }[];
}

export interface ConstellationTool {
  name: string;
  url: string;
  envFromSecret?: string;
  from?: string; // contributing pack
}

export interface ConstellationKb {
  name: string;
  role: string;
  from?: string;
}

export interface ConstellationBrainModel {
  id: string;
  name?: string;
}

export interface ConstellationProps {
  emoji: string;
  name: string;
  role?: string;
  systemPrompt?: string;
  brain: {
    label: string;
    connection?: string;
    description?: string;
    kind?: string;
    models: ConstellationBrainModel[];
    chosen: string;
  };
  skills: ConstellationSkill[];
  tools: ConstellationTool[];
  knowledge: ConstellationKb[];
  team?: {
    gateway: string;
    members: string[];
    isNew: boolean;
    ready?: boolean;
    reason?: string;
  };
  onRemovePack?: (name: string) => void;
}

type Sel =
  | { kind: 'core' }
  | { kind: 'brain' }
  | { kind: 'skill'; name: string }
  | { kind: 'tool'; name: string }
  | { kind: 'kb'; name: string }
  | { kind: 'team' }
  | null;

const W = 640;
const C = W / 2;

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
};

const PACK_HUES = [265, 320, 190, 48, 138, 20, 288, 210];
export const packHue = (idx: number) => PACK_HUES[idx % PACK_HUES.length];

const dimWhenUnselected = (sel: Sel, mine: boolean) => (sel && !mine ? 0.28 : 1);

/** Dot-arc rows between radii; big dots carry <title> tooltips. */
const dotArc = (
  key: string,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  labels: string[],
  hue: number,
) => {
  const dots: React.ReactNode[] = [];
  const target = labels.length * 3;
  const rows = Math.max(2, Math.min(6, Math.ceil(target / 9)));
  let placed = 0;
  for (let row = 0; row < rows && placed < 200; row++) {
    const r = r0 + ((r1 - r0) * (row + 0.5)) / rows;
    const span = a1 - a0;
    const per = Math.max(3, Math.round((span / 360) * (r / 2.2)));
    for (let i = 0; i < per; i++) {
      const deg = a0 + (span * (i + 0.5)) / per;
      const { x, y } = polar(r, deg);
      const big = placed < target;
      const label = big ? labels[Math.floor(placed / 3) % labels.length] : undefined;
      dots.push(
        <circle
          key={`${key}-${row}-${i}`}
          cx={x}
          cy={y}
          r={big ? 2.4 : 1.1}
          fill={`hsl(${hue} 85% ${big ? 72 : 38}%)`}
          opacity={big ? 0.95 : 0.35}
        >
          {label && <title>{label}</title>}
        </circle>,
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
    <text fontSize={13} fontWeight={700} letterSpacing={4} fill={`hsl(${hue} 80% 70%)`} opacity={0.9}>
      <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
        {text}
      </textPath>
    </text>
  </>
);

/* ---------- drill-in panel ---------- */

const panelStyles: React.CSSProperties = {
  width: 300,
  minWidth: 260,
  background: 'linear-gradient(180deg, #171331 0%, #0f0c1d 100%)',
  border: '1px solid #322a58',
  borderRadius: 10,
  padding: '14px 16px',
  color: '#e8e2ff',
  fontSize: 13,
  alignSelf: 'stretch',
  overflowY: 'auto',
  maxHeight: 560,
};

const PLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10, letterSpacing: 2, color: '#8f86ad', marginTop: 10 }}>{children}</div>
);

const Chip: React.FC<{ hue?: number; children: React.ReactNode }> = ({ hue = 265, children }) => (
  <span
    style={{
      display: 'inline-block',
      border: `1px solid hsl(${hue} 70% 55%)`,
      color: `hsl(${hue} 80% 78%)`,
      borderRadius: 999,
      padding: '1px 8px',
      fontSize: 11,
      margin: '2px 4px 2px 0',
    }}
  >
    {children}
  </span>
);

const DrillPanel: React.FC<ConstellationProps & { sel: Sel; onClose: () => void }> = props => {
  const { sel } = props;
  if (!sel) {
    return (
      <div style={panelStyles}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#8f86ad' }}>CONSTELLATION</div>
        <p style={{ marginTop: 8, lineHeight: 1.5, color: '#b9b1d6' }}>
          Click anything — the core, the brain ring, a skill cluster, a tool
          hex, a knowledge moon, or the team ring — to drill into it.
        </p>
        <PLabel>AT A GLANCE</PLabel>
        <p style={{ margin: '6px 0', lineHeight: 1.7 }}>
          🧠 {props.brain.label}
          <br />✨ {props.skills.reduce((n, s) => n + s.leaves.length, 0)} skills in{' '}
          {props.skills.length} pack(s)
          <br />🔧 {props.tools.length} tool endpoint(s) · 📚 {props.knowledge.length} knowledge
          base(s)
          <br />👥 {props.team ? `${props.team.gateway}${props.team.isNew ? ' (new team)' : ''}` : 'no team yet'}
        </p>
      </div>
    );
  }

  const close = (
    <button
      onClick={props.onClose}
      style={{
        float: 'right',
        background: 'none',
        border: 'none',
        color: '#8f86ad',
        cursor: 'pointer',
        fontSize: 16,
        lineHeight: 1,
      }}
      aria-label="close details"
    >
      ×
    </button>
  );

  if (sel.kind === 'core') {
    return (
      <div style={panelStyles}>
        {close}
        <div style={{ fontSize: 22 }}>{props.emoji} </div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{props.name}</div>
        <PLabel>ROLE</PLabel>
        <div>{props.role || 'assistant'}</div>
        <PLabel>SYSTEM PROMPT</PLabel>
        <div style={{ color: '#b9b1d6', whiteSpace: 'pre-wrap', lineHeight: 1.45, fontSize: 12 }}>
          {(props.systemPrompt || '').slice(0, 600)}
          {(props.systemPrompt || '').length > 600 ? '…' : ''}
        </div>
      </div>
    );
  }

  if (sel.kind === 'brain') {
    return (
      <div style={panelStyles}>
        {close}
        <div style={{ fontWeight: 700, fontSize: 15, color: 'hsl(18 90% 70%)' }}>Brain</div>
        <PLabel>CONNECTION</PLabel>
        <div>{props.brain.connection || '—'}</div>
        {props.brain.description && (
          <div style={{ color: '#b9b1d6', fontSize: 12, marginTop: 2 }}>{props.brain.description}</div>
        )}
        <PLabel>MODEL</PLabel>
        <div>
          {props.brain.models.map(m => (
            <Chip key={m.id} hue={m.id === props.brain.chosen ? 18 : 250}>
              {m.id === props.brain.chosen ? '● ' : ''}
              {m.name || m.id}
            </Chip>
          ))}
        </div>
        <p style={{ color: '#8f86ad', fontSize: 11, marginTop: 10 }}>
          Change it in the Brain section below the constellation.
        </p>
      </div>
    );
  }

  if (sel.kind === 'skill') {
    const s = props.skills.find(x => x.name === sel.name);
    if (!s) return null;
    return (
      <div style={panelStyles}>
        {close}
        <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${s.hue} 85% 72%)` }}>
          {s.displayName || s.name}
        </div>
        <div style={{ color: '#8f86ad', fontSize: 11 }}>
          {s.artifactKind || 'skill'}
          {s.version ? ` · v${s.version}` : ''}
          {s.installed === false ? ` · installs from ${s.registry || 'registry'} on create` : ''}
        </div>
        {s.reason && (
          <>
            <PLabel>WHY SUGGESTED</PLabel>
            <div style={{ color: '#b9b1d6', fontSize: 12 }}>{s.reason}</div>
          </>
        )}
        <PLabel>WHAT'S INSIDE ({s.leaves.length})</PLabel>
        {s.tree.map(t => (
          <div key={t.pack} style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{t.pack}</div>
            {t.skills.map(l => (
              <div key={l.name} style={{ paddingLeft: 12, fontSize: 12, color: '#b9b1d6' }}>
                • {l.name}
                {l.installed ? ' ✓' : ''}
              </div>
            ))}
          </div>
        ))}
        {s.unmet.length > 0 && (
          <>
            <PLabel>MISSING ON THIS CLUSTER</PLabel>
            {s.unmet.map(d => (
              <Chip key={d.name} hue={35}>
                {d.name} ({d.kind})
              </Chip>
            ))}
          </>
        )}
        {s.requires.length > 0 && (
          <>
            <PLabel>REQUIRES</PLabel>
            {s.requires.map(r => (
              <Chip key={r.name} hue={r.satisfied ? 138 : 35}>
                {r.name}
                {r.range ? ` ${r.range}` : ''}
                {r.satisfied ? '' : ' ✗'}
              </Chip>
            ))}
          </>
        )}
        {props.onRemovePack && (
          <button
            onClick={() => {
              props.onRemovePack!(s.name);
              props.onClose();
            }}
            style={{
              marginTop: 12,
              background: 'none',
              border: '1px solid hsl(0 70% 55%)',
              color: 'hsl(0 80% 72%)',
              borderRadius: 6,
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Remove from agent
          </button>
        )}
      </div>
    );
  }

  if (sel.kind === 'tool') {
    const t = props.tools.find(x => x.name === sel.name);
    if (!t) return null;
    return (
      <div style={panelStyles}>
        {close}
        <div style={{ fontWeight: 700, fontSize: 15, color: 'hsl(28 90% 70%)' }}>{t.name}</div>
        <PLabel>ENDPOINT</PLabel>
        <div style={{ wordBreak: 'break-all', fontSize: 12, color: '#b9b1d6' }}>{t.url}</div>
        {t.envFromSecret && (
          <>
            <PLabel>CREDENTIAL</PLabel>
            <div style={{ fontSize: 12 }}>secret: {t.envFromSecret} (gateway-side)</div>
          </>
        )}
        <PLabel>CONTRIBUTED BY</PLabel>
        <div>{t.from ? <Chip hue={265}>{t.from}</Chip> : 'direct selection'}</div>
        <p style={{ color: '#8f86ad', fontSize: 11, marginTop: 10 }}>
          Tools arrive with their packs — remove the pack to drop its tools.
        </p>
      </div>
    );
  }

  if (sel.kind === 'kb') {
    const k = props.knowledge.find(x => x.name === sel.name);
    if (!k) return null;
    return (
      <div style={panelStyles}>
        {close}
        <div style={{ fontWeight: 700, fontSize: 15, color: 'hsl(160 75% 65%)' }}>{k.name}</div>
        <PLabel>ROLE</PLabel>
        <div>{k.role}</div>
        <PLabel>CONTRIBUTED BY</PLabel>
        <div>{k.from ? <Chip hue={265}>{k.from}</Chip> : 'direct selection'}</div>
      </div>
    );
  }

  // team
  return (
    <div style={panelStyles}>
      {close}
      <div style={{ fontWeight: 700, fontSize: 15, color: 'hsl(210 80% 70%)' }}>
        {props.team?.gateway}
      </div>
      <div style={{ color: '#8f86ad', fontSize: 11 }}>
        {props.team?.isNew ? 'new team — the gateway is created with this agent' : 'existing team'}
        {props.team?.ready === false ? ' · gateway not ready' : ''}
      </div>
      {props.team?.reason && (
        <>
          <PLabel>WHY HERE</PLabel>
          <div style={{ color: '#b9b1d6', fontSize: 12 }}>{props.team.reason}</div>
        </>
      )}
      <PLabel>CREW</PLabel>
      {(props.team?.members ?? []).length === 0 && <div>first agent on this gateway</div>}
      {(props.team?.members ?? []).map(m => (
        <Chip key={m} hue={210}>
          {m}
        </Chip>
      ))}
      <p style={{ color: '#8f86ad', fontSize: 11, marginTop: 10 }}>
        The team is chosen by the platform — a gateway is a shared runtime and
        blast radius, not a dropdown.
      </p>
    </div>
  );
};

/* ---------- the constellation ---------- */

export const AgentConstellation: React.FC<ConstellationProps> = props => {
  const { emoji, name, brain, skills, tools, knowledge, team } = props;
  const [sel, setSel] = React.useState<Sel>(null);

  const pick = (s: Exclude<Sel, null>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSel(cur => (JSON.stringify(cur) === JSON.stringify(s) ? null : s));
  };

  const segs: { s: ConstellationSkill; a0: number; a1: number }[] = [];
  if (skills.length) {
    const gap = 14;
    const span = (360 - gap * skills.length) / skills.length;
    let a = -90 + gap / 2;
    for (const s of skills) {
      segs.push({ s, a0: a, a1: a + span });
      a += span + gap;
    }
  }

  const toolNodes = tools.slice(0, 14);
  const kbNodes = knowledge.slice(0, 10);
  const crew = team?.members?.slice(0, 8) ?? [];

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <div
        style={{
          flex: '1 1 380px',
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
          .aoc-hit { cursor: pointer; }
          .aoc-hit:hover { filter: brightness(1.5); }
          @media (prefers-reduced-motion: reduce) {
            .aoc-slow, .aoc-slower, .aoc-core { animation: none; }
          }
        `}</style>
        <svg
          viewBox={`0 0 ${W} ${W}`}
          style={{ width: '100%', maxHeight: 560, display: 'block' }}
          onClick={() => setSel(null)}
        >
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

          {/* TEAM */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'team')}>
            <g className="aoc-slower">
              <circle
                cx={C}
                cy={C}
                r={288}
                fill="none"
                stroke="hsl(210 70% 55%)"
                strokeWidth={1}
                opacity={0.5}
                strokeDasharray="1 6"
              />
              {crew.map((m, i) => {
                const { x, y } = polar(288, (360 / Math.max(crew.length, 1)) * i + 18);
                return (
                  <g key={`crew-${m}`} filter="url(#aoc-glow)" className="aoc-hit" onClick={pick({ kind: 'team' })}>
                    <title>{m}</title>
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
              <text
                className="aoc-hit"
                onClick={pick({ kind: 'team' })}
                x={C}
                y={C - 296}
                textAnchor="middle"
                fontSize={12}
                fontWeight={700}
                letterSpacing={4}
                fill="hsl(210 80% 70%)"
              >
                TEAM · {team.gateway.toUpperCase()}
                {team.isNew ? ' (NEW)' : ''}
              </text>
            )}
          </g>

          {/* KNOWLEDGE */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'kb')}>
            <circle cx={C} cy={C} r={248} fill="none" stroke="hsl(160 60% 45%)" strokeWidth={0.8} opacity={0.4} />
            <RingLabel r={252} text={kbNodes.length ? 'KNOWLEDGE' : ''} hue={160} id="aoc-kb-ring" />
            {kbNodes.map((k, i) => {
              const { x, y } = polar(248, (360 / Math.max(kbNodes.length, 1)) * i + 45);
              const mine = sel?.kind === 'kb' && sel.name === k.name;
              return (
                <g
                  key={`kb-${k.name}`}
                  filter="url(#aoc-glow)"
                  className="aoc-hit"
                  onClick={pick({ kind: 'kb', name: k.name })}
                  opacity={dimWhenUnselected(sel, mine || sel?.kind !== 'kb')}
                >
                  <title>{k.name}</title>
                  <circle cx={x} cy={y} r={9} fill="#0d1a16" stroke="hsl(160 75% 55%)" strokeWidth={1.4} />
                  <circle cx={x} cy={y} r={13} fill="none" stroke="hsl(160 75% 55%)" strokeWidth={0.6} opacity={0.5} />
                  <text x={x} y={y + 3.5} textAnchor="middle" fontSize={8.5} fill="hsl(160 75% 75%)">
                    {k.name.slice(0, 2).toUpperCase()}
                  </text>
                </g>
              );
            })}
          </g>

          {/* TOOLS */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'tool')}>
            <g className="aoc-slow">
              <circle
                cx={C}
                cy={C}
                r={208}
                fill="none"
                stroke="hsl(28 80% 55%)"
                strokeWidth={0.8}
                opacity={0.35}
                strokeDasharray="2 5"
              />
              {toolNodes.map((t, i) => {
                const { x, y } = polar(208, (360 / Math.max(toolNodes.length, 1)) * i);
                return (
                  <g
                    key={`tool-${t.name}`}
                    filter="url(#aoc-glow)"
                    className="aoc-hit"
                    onClick={pick({ kind: 'tool', name: t.name })}
                  >
                    <title>{t.name}</title>
                    <path
                      d={`M ${x - 10} ${y} l 5 -8.7 h 10 l 5 8.7 l -5 8.7 h -10 Z`}
                      fill="#161022"
                      stroke="hsl(28 90% 60%)"
                      strokeWidth={1.3}
                    />
                    <text x={x} y={y + 3.5} textAnchor="middle" fontSize={8.5} fill="hsl(28 90% 75%)">
                      {t.name.slice(0, 2).toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </g>
            <RingLabel r={214} text={toolNodes.length ? 'TOOLS' : ''} hue={28} id="aoc-tool-ring" />
          </g>

          {/* SKILLS */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'skill')}>
            <RingLabel r={172} text={skills.length ? 'SKILLS' : ''} hue={280} id="aoc-skill-ring" />
            {segs.map(({ s, a0, a1 }) => {
              const mine = sel?.kind === 'skill' && sel.name === s.name;
              return (
                <g
                  key={`seg-${s.name}`}
                  className="aoc-hit"
                  onClick={pick({ kind: 'skill', name: s.name })}
                  opacity={dimWhenUnselected(sel, mine || sel?.kind !== 'skill')}
                >
                  {dotArc(`arc-${s.name}`, a0, a1, 118, 166, s.leaves, s.hue)}
                  {(() => {
                    const mid = (a0 + a1) / 2;
                    const { x, y } = polar(186, mid);
                    return (
                      <g filter="url(#aoc-glow)">
                        <title>{s.displayName || s.name}</title>
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
                          {(s.displayName || s.name).toUpperCase().slice(0, 18)}
                        </text>
                        <text x={x} y={y + 20} textAnchor="middle" fontSize={8} fill={`hsl(${s.hue} 60% 65%)`}>
                          {s.leaves.length}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}
          </g>

          {/* BRAIN */}
          <g
            opacity={dimWhenUnselected(sel, sel?.kind === 'brain')}
            className="aoc-hit"
            onClick={pick({ kind: 'brain' })}
          >
            <title>{brain.label}</title>
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
          </g>

          {/* core */}
          <g
            filter="url(#aoc-glow)"
            className="aoc-hit"
            onClick={pick({ kind: 'core' })}
            opacity={dimWhenUnselected(sel, sel?.kind === 'core')}
          >
            <title>{name}</title>
            <circle className="aoc-core" cx={C} cy={C} r={30} fill="#1c1428" stroke="hsl(30 90% 60%)" strokeWidth={1.6} />
            <text x={C} y={C + 7} textAnchor="middle" fontSize={22}>
              {emoji || '🤖'}
            </text>
          </g>
          <text x={C} y={C + 48} textAnchor="middle" fontSize={13} fontWeight={700} letterSpacing={2} fill="#f2ecff">
            {(name || 'AGENT').toUpperCase()}
          </text>
          <text x={C} y={C + 63} textAnchor="middle" fontSize={9.5} fill="hsl(18 90% 72%)">
            {brain.label}
          </text>
          {brain.connection && (
            <text x={C} y={C + 76} textAnchor="middle" fontSize={8.5} fill="#8f86ad">
              {brain.connection}
            </text>
          )}
        </svg>
      </div>
      <DrillPanel {...props} sel={sel} onClose={() => setSel(null)} />
    </div>
  );
};

export default AgentConstellation;
