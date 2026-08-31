import React from 'react';

/*
 * <AgentConstellation> — the agent, drawn; strength you can read.
 *
 * Design grammar (borrowed from the second-brain orbital dashboards,
 * mapped honestly to hire-time data):
 *
 *   The STADIUM FIELD — the big variable mass — belongs to whatever
 *   carries real variable strength. At hire time that is SKILLS, so
 *   each selected pack is a wedge of stadium rows:
 *
 *      · ROWS (radial depth)  = how much it knows — leaf-skill
 *        count, normalized to the agent's deepest pack
 *      · BRIGHTNESS gradient  = biggest/brightest rows toward the
 *        center, fading to the rim (the reference's look)
 *      · UNLIT OUTER ROWS     = readiness — the fraction of the
 *        pack's cluster dependencies not yet deployed renders as
 *        hollow dots: capability that exists but is not live HERE
 *
 *   Layers inside → out:
 *      core     identity
 *      BRAIN    tight static diamond ring, model name on the ring
 *      SKILLS   the stadium field (wedges, labeled, counted)
 *      MEMORY   compact pool ring (workspace seeds + KBs) — small at
 *               hire by honest necessity; it earns the big-field
 *               treatment in the live-agent view once it has volume
 *      TOOLS    hex satellites, slow orbit
 *      TEAM     gateway + crew, outermost
 *
 * Everything clicks into a drill panel. Deterministic layout: same
 * agent ⇒ same constellation. Honors prefers-reduced-motion.
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
  tier?: string;
  reason?: string;
  installed?: boolean;
  registry?: string;
  leaves: string[];
  tree: ConstellationTree[];
  depsTotal: number;
  depsUnmet: { name: string; kind: string }[];
  requires: { name: string; range?: string; satisfied: boolean }[];
}

export interface ConstellationTool {
  name: string;
  url: string;
  envFromSecret?: string;
  from?: string;
}

export interface ConstellationMemory {
  name: string;
  kind: 'workspace' | 'kb';
  count: number;
  detail?: string;
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
  memory: ConstellationMemory[];
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
  | { kind: 'memory'; name: string }
  | { kind: 'team' }
  | null;

const W = 640;
const C = W / 2;
const PANEL_H = 600;

// Radii — the skills stadium owns the mass of the circle.
const R_BRAIN_IN = 58;
const R_BRAIN_OUT = 70;
const R_FIELD_IN = 96;
const R_FIELD_OUT = 224;
const R_MEMORY = 248;
const R_TOOLS = 274;
const R_TEAM = 298;

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
};

const PACK_HUES = [265, 320, 190, 48, 138, 20, 288, 210];
export const packHue = (idx: number) => PACK_HUES[idx % PACK_HUES.length];
const MEM_HUES = [275, 315, 195, 52, 145, 232];

const dimWhenUnselected = (sel: Sel, mine: boolean) => (sel && !mine ? 0.25 : 1);

/**
 * Stadium wedge: rows of dots from R_FIELD_IN outward. depth01 sets
 * how many of the possible rows exist; readiness01 sets which
 * fraction of those rows are LIT (solid, bright) vs UNLIT (hollow) —
 * unlit rows are always the outermost. Brightness and dot size decay
 * with row index, so the wedge glows at its base like stadium
 * lighting.
 */
const stadiumWedge = (
  key: string,
  a0: number,
  a1: number,
  depth01: number,
  readiness01: number,
  hue: number,
  labels: string[],
) => {
  const MAX_ROWS = 11;
  const rows = Math.max(2, Math.round(MAX_ROWS * depth01));
  const litRows = Math.max(1, Math.round(rows * readiness01));
  const nodes: React.ReactNode[] = [];
  let li = 0;
  for (let row = 0; row < rows; row++) {
    const r = R_FIELD_IN + ((R_FIELD_OUT - R_FIELD_IN) * (row + 0.5)) / MAX_ROWS;
    const span = a1 - a0;
    const per = Math.max(4, Math.round((span / 360) * (r / 2.0)));
    const t = row / Math.max(rows - 1, 1); // 0 center → 1 rim
    const lit = row < litRows;
    const size = 3.0 - 1.7 * t;
    const light = 76 - 34 * t;
    const op = 1 - 0.55 * t;
    for (let i = 0; i < per; i++) {
      const deg = a0 + (span * (i + 0.5)) / per;
      const { x, y } = polar(r, deg);
      const label = labels.length ? labels[li++ % labels.length] : undefined;
      nodes.push(
        lit ? (
          <circle key={`${key}-${row}-${i}`} cx={x} cy={y} r={size} fill={`hsl(${hue} 85% ${light}%)`} opacity={op}>
            {label && <title>{label}</title>}
          </circle>
        ) : (
          <circle
            key={`${key}-${row}-${i}`}
            cx={x}
            cy={y}
            r={size * 0.9}
            fill="none"
            stroke={`hsl(${hue} 45% 40%)`}
            strokeWidth={0.8}
            opacity={0.5}
          >
            <title>awaiting cluster prerequisite</title>
          </circle>
        ),
      );
    }
  }
  return { nodes, rows, litRows };
};

const RingLabel: React.FC<{ r: number; text: string; hue: number; id: string }> = ({ r, text, hue, id }) => (
  <>
    <defs>
      <path id={id} d={`M ${C - r} ${C} A ${r} ${r} 0 0 1 ${C + r} ${C}`} />
    </defs>
    <text fontSize={12.5} fontWeight={700} letterSpacing={4} fill={`hsl(${hue} 80% 70%)`} opacity={0.9}>
      <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
        {text}
      </textPath>
    </text>
  </>
);

/* ---------- drill-in panel ---------- */

const panelStyles: React.CSSProperties = {
  flex: '0 1 300px',
  minWidth: 260,
  height: PANEL_H,
  boxSizing: 'border-box',
  background: 'linear-gradient(180deg, #171331 0%, #0f0c1d 100%)',
  border: '1px solid #322a58',
  borderRadius: 12,
  padding: '14px 16px',
  color: '#e8e2ff',
  fontSize: 13,
  overflowY: 'auto',
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

const StrengthBar: React.FC<{ hue: number; depth01: number; readiness01: number }> = ({
  hue,
  depth01,
  readiness01,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <div style={{ flex: 1, height: 7, background: '#241d42', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
      <div
        style={{
          width: `${Math.round(depth01 * readiness01 * 100)}%`,
          background: `hsl(${hue} 80% 62%)`,
        }}
      />
      <div
        style={{
          width: `${Math.round(depth01 * (1 - readiness01) * 100)}%`,
          background: `hsl(${hue} 35% 35%)`,
        }}
      />
    </div>
  </div>
);

const skillDepth = (s: ConstellationSkill, maxLeaves: number) =>
  Math.max(0.18, s.leaves.length / Math.max(maxLeaves, 1));
const skillReadiness = (s: ConstellationSkill) =>
  s.depsTotal === 0 ? 1 : Math.max(0.15, (s.depsTotal - s.depsUnmet.length) / s.depsTotal);

const DrillPanel: React.FC<ConstellationProps & { sel: Sel; onClose: () => void }> = props => {
  const { sel } = props;
  const maxLeaves = Math.max(...props.skills.map(s => s.leaves.length), 1);

  if (!sel) {
    return (
      <div style={panelStyles}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#8f86ad' }}>CONSTELLATION</div>
        <p style={{ marginTop: 8, lineHeight: 1.5, color: '#b9b1d6' }}>
          Click anything to drill in. The stadium field is the agent's
          strength: <strong>row depth = how much it knows</strong>, bright at
          the base; <strong>hollow rim dots = not yet live here</strong>{' '}
          (missing cluster prerequisites).
        </p>
        <PLabel>STRENGTH</PLabel>
        {props.skills.length === 0 && (
          <p style={{ color: '#8f86ad', fontSize: 12 }}>No skills selected yet.</p>
        )}
        {props.skills.map(s => (
          <div key={s.name} style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: `hsl(${s.hue} 85% 75%)` }}>{s.displayName || s.name}</span>
              <span style={{ color: '#8f86ad' }}>
                {s.leaves.length} · {Math.round(skillReadiness(s) * 100)}% live
              </span>
            </div>
            <StrengthBar hue={s.hue} depth01={skillDepth(s, maxLeaves)} readiness01={skillReadiness(s)} />
          </div>
        ))}
        <PLabel>AT A GLANCE</PLabel>
        <p style={{ margin: '6px 0', lineHeight: 1.8 }}>
          🧠 {props.brain.label}
          <br />🗂 {props.memory.length} memory pool(s) · 🔧 {props.tools.length} tool(s)
          <br />👥{' '}
          {props.team ? `${props.team.gateway}${props.team.isNew ? ' (new team)' : ''}` : 'no team yet'}
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
          {(props.systemPrompt || '').slice(0, 700)}
          {(props.systemPrompt || '').length > 700 ? '…' : ''}
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
          Change it in the Brain section below. The brain ring never rotates —
          it is the agent's center of gravity.
        </p>
      </div>
    );
  }

  if (sel.kind === 'skill') {
    const s = props.skills.find(x => x.name === sel.name);
    if (!s) return null;
    const readiness = skillReadiness(s);
    return (
      <div style={panelStyles}>
        {close}
        <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${s.hue} 85% 72%)` }}>
          {s.displayName || s.name}
        </div>
        <div style={{ color: '#8f86ad', fontSize: 11 }}>
          {s.artifactKind || 'skill'}
          {s.version ? ` · v${s.version}` : ''}
          {s.tier ? ` · tier: ${s.tier}` : ''}
          {s.installed === false ? ` · installs from ${s.registry || 'registry'} on create` : ''}
        </div>
        <PLabel>STRENGTH</PLabel>
        <StrengthBar hue={s.hue} depth01={skillDepth(s, maxLeaves)} readiness01={readiness} />
        <div style={{ fontSize: 11, color: '#8f86ad', marginTop: 4 }}>
          depth: {s.leaves.length} skill(s) · readiness: {Math.round(readiness * 100)}% of
          prerequisites live on this cluster
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
        {s.depsUnmet.length > 0 && (
          <>
            <PLabel>UNLIT — MISSING ON THIS CLUSTER</PLabel>
            {s.depsUnmet.map(d => (
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

  if (sel.kind === 'memory') {
    const m = props.memory.find(x => x.name === sel.name);
    if (!m) return null;
    return (
      <div style={panelStyles}>
        {close}
        <div style={{ fontWeight: 700, fontSize: 15, color: 'hsl(275 75% 72%)' }}>{m.name}</div>
        <div style={{ color: '#8f86ad', fontSize: 11 }}>
          {m.kind === 'workspace' ? 'seeded workspace' : 'knowledge base'}
        </div>
        <PLabel>{m.kind === 'workspace' ? 'SEEDED AT HIRE' : 'ROLE'}</PLabel>
        <div style={{ color: '#b9b1d6', fontSize: 12, whiteSpace: 'pre-wrap' }}>{m.detail}</div>
        {m.from && (
          <>
            <PLabel>CONTRIBUTED BY</PLabel>
            <Chip hue={265}>{m.from}</Chip>
          </>
        )}
        <PLabel>WHY THIS RING IS SMALL</PLabel>
        <p style={{ color: '#8f86ad', fontSize: 11, lineHeight: 1.5 }}>
          At hire time an agent's memory is only its seeds. Memory earns the
          stadium treatment in the live agent view, where it grows with every
          working day.
        </p>
      </div>
    );
  }

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
  const { emoji, name, brain, skills, tools, memory, team } = props;
  const [sel, setSel] = React.useState<Sel>(null);

  const pick = (s: Exclude<Sel, null>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSel(cur => (JSON.stringify(cur) === JSON.stringify(s) ? null : s));
  };

  const maxLeaves = Math.max(...skills.map(s => s.leaves.length), 1);

  // Equal-angle wedges: strength lives in DEPTH (stadium rows), not width.
  const gap = 10;
  const span = skills.length ? (360 - gap * skills.length) / skills.length : 0;
  const wedges = skills.map((s, i) => ({
    s,
    a0: -90 + gap / 2 + i * (span + gap),
    a1: -90 + gap / 2 + i * (span + gap) + span,
  }));

  const toolNodes = tools.slice(0, 14);
  const crew = team?.members?.slice(0, 8) ?? [];

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
      <div
        style={{
          flex: '1 1 380px',
          height: PANEL_H,
          boxSizing: 'border-box',
          background: 'radial-gradient(ellipse at center, #17142b 0%, #0b0a14 70%)',
          borderRadius: 12,
          padding: 8,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
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
          style={{ width: '100%', flex: 1, minHeight: 0, display: 'block' }}
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

          <circle cx={C} cy={C} r={306} fill="url(#aoc-hex)" opacity={0.5} />

          {/* faint web: core → wedge hubs */}
          {wedges.map(({ s, a0, a1 }) => {
            const { x, y } = polar(R_FIELD_OUT, (a0 + a1) / 2);
            return (
              <line
                key={`web-${s.name}`}
                x1={C}
                y1={C}
                x2={x}
                y2={y}
                stroke="#3a3160"
                strokeWidth={0.5}
                opacity={0.4}
              />
            );
          })}

          {/* TEAM */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'team')}>
            <g className="aoc-slower">
              <circle
                cx={C}
                cy={C}
                r={R_TEAM}
                fill="none"
                stroke="hsl(210 70% 55%)"
                strokeWidth={1}
                opacity={0.5}
                strokeDasharray="1 6"
              />
              {crew.map((m, i) => {
                const { x, y } = polar(R_TEAM, (360 / Math.max(crew.length, 1)) * i + 18);
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
                y={C - R_TEAM - 8}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={700}
                letterSpacing={4}
                fill="hsl(210 80% 70%)"
              >
                TEAM · {team.gateway.toUpperCase()}
                {team.isNew ? ' (NEW)' : ''}
              </text>
            )}
          </g>

          {/* TOOLS */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'tool')}>
            <g className="aoc-slow">
              <circle
                cx={C}
                cy={C}
                r={R_TOOLS}
                fill="none"
                stroke="hsl(28 80% 55%)"
                strokeWidth={0.8}
                opacity={0.35}
                strokeDasharray="2 5"
              />
              {toolNodes.map((t, i) => {
                const { x, y } = polar(R_TOOLS, (360 / Math.max(toolNodes.length, 1)) * i);
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
          </g>

          {/* MEMORY — compact pool ring */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'memory')}>
            <circle cx={C} cy={C} r={R_MEMORY} fill="none" stroke="hsl(275 55% 50%)" strokeWidth={0.7} opacity={0.35} />
            <RingLabel r={R_MEMORY + 6} text={memory.length ? 'MEMORY' : ''} hue={275} id="aoc-mem-ring" />
            {memory.slice(0, 10).map((m, i) => {
              const hue = MEM_HUES[i % MEM_HUES.length];
              const mine = sel?.kind === 'memory' && sel.name === m.name;
              const deg = (360 / Math.max(memory.length, 1)) * i + 30;
              const { x, y } = polar(R_MEMORY, deg);
              const halo = Math.min(4, Math.max(1, Math.ceil(m.count / 3)));
              return (
                <g
                  key={`mem-${m.name}`}
                  className="aoc-hit"
                  onClick={pick({ kind: 'memory', name: m.name })}
                  opacity={dimWhenUnselected(sel, mine || sel?.kind !== 'memory')}
                  filter="url(#aoc-glow)"
                >
                  <title>{`${m.name} · ${m.count}`}</title>
                  {Array.from({ length: halo }, (_, h) => (
                    <circle
                      key={`h-${h}`}
                      cx={x}
                      cy={y}
                      r={9 + h * 4}
                      fill="none"
                      stroke={`hsl(${hue} 70% 60%)`}
                      strokeWidth={h === 0 ? 0 : 0.7}
                      opacity={0.6 - h * 0.12}
                    />
                  ))}
                  <circle cx={x} cy={y} r={8} fill="#140f22" stroke={`hsl(${hue} 75% 60%)`} strokeWidth={1.4} />
                  <text x={x} y={y + 3.5} textAnchor="middle" fontSize={8} fill={`hsl(${hue} 80% 78%)`}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </text>
                </g>
              );
            })}
          </g>

          {/* SKILLS — the stadium field */}
          <g opacity={dimWhenUnselected(sel, sel?.kind === 'skill')}>
            {wedges.map(({ s, a0, a1 }) => {
              const mine = sel?.kind === 'skill' && sel.name === s.name;
              const depth = skillDepth(s, maxLeaves);
              const readiness = skillReadiness(s);
              const { nodes, rows, litRows } = stadiumWedge(
                `w-${s.name}`,
                a0,
                a1,
                depth,
                readiness,
                s.hue,
                s.leaves,
              );
              const mid = (a0 + a1) / 2;
              const topR = R_FIELD_IN + ((R_FIELD_OUT - R_FIELD_IN) * rows) / 11;
              const hub = polar(topR + 14, mid);
              return (
                <g
                  key={`seg-${s.name}`}
                  className="aoc-hit"
                  onClick={pick({ kind: 'skill', name: s.name })}
                  opacity={dimWhenUnselected(sel, mine || sel?.kind !== 'skill')}
                >
                  {nodes}
                  <g filter="url(#aoc-glow)">
                    <title>{`${s.displayName || s.name} · ${s.leaves.length} skill(s) · ${Math.round(readiness * 100)}% live`}</title>
                    <circle cx={hub.x} cy={hub.y} r={6.5} fill={`hsl(${s.hue} 80% 60%)`} opacity={0.95} />
                    <text
                      x={hub.x}
                      y={hub.y - 11}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      letterSpacing={1}
                      fill={`hsl(${s.hue} 85% 78%)`}
                    >
                      {(s.displayName || s.name).toUpperCase().slice(0, 16)}
                    </text>
                    <text x={hub.x} y={hub.y + 17} textAnchor="middle" fontSize={8} fill={`hsl(${s.hue} 60% 65%)`}>
                      {s.leaves.length}
                      {litRows < rows ? ' ◌' : ''}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>

          {/* BRAIN — tight static diamond ring */}
          <g
            opacity={dimWhenUnselected(sel, sel?.kind === 'brain')}
            className="aoc-hit"
            onClick={pick({ kind: 'brain' })}
          >
            <title>
              {brain.label}
              {brain.connection ? ` — ${brain.connection}` : ''}
            </title>
            {[R_BRAIN_OUT, R_BRAIN_IN].map((r, ringIdx) =>
              Array.from({ length: ringIdx === 0 ? 26 : 18 }, (_, i) => {
                const { x, y } = polar(r, (360 / (ringIdx === 0 ? 26 : 18)) * i);
                return (
                  <rect
                    key={`br-${r}-${i}`}
                    x={x - 2.4}
                    y={y - 2.4}
                    width={4.8}
                    height={4.8}
                    transform={`rotate(45 ${x} ${y})`}
                    fill="hsl(18 95% 58%)"
                    opacity={0.9}
                  />
                );
              }),
            )}
            <RingLabel
              r={R_BRAIN_OUT + 12}
              text={`BRAIN · ${brain.label.toUpperCase().slice(0, 24)}`}
              hue={18}
              id="aoc-brain-ring"
            />
          </g>

          {/* core */}
          <g
            filter="url(#aoc-glow)"
            className="aoc-hit"
            onClick={pick({ kind: 'core' })}
            opacity={dimWhenUnselected(sel, sel?.kind === 'core')}
          >
            <title>{name}</title>
            <circle className="aoc-core" cx={C} cy={C} r={26} fill="#1c1428" stroke="hsl(30 90% 60%)" strokeWidth={1.6} />
            <text x={C} y={C + 7} textAnchor="middle" fontSize={20}>
              {emoji || '🤖'}
            </text>
          </g>
          <text x={C} y={C + 42} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing={2} fill="#f2ecff">
            {(name || 'AGENT').toUpperCase()}
          </text>
        </svg>
        <div
          style={{
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            padding: '6px 0 2px',
            fontSize: 10.5,
            letterSpacing: 1,
            color: '#8f86ad',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: 'hsl(18 90% 66%)' }}>◆ BRAIN</span>
          <span style={{ color: 'hsl(280 80% 72%)' }}>● SKILLS — depth = knowledge, hollow rim = not live yet</span>
          <span style={{ color: 'hsl(275 70% 72%)' }}>◍ MEMORY</span>
          <span style={{ color: 'hsl(28 90% 66%)' }}>⬡ TOOLS</span>
          <span style={{ color: 'hsl(210 80% 68%)' }}>⬢ TEAM</span>
        </div>
      </div>
      <DrillPanel {...props} sel={sel} onClose={() => setSel(null)} />
    </div>
  );
};

export default AgentConstellation;
