import React from 'react';

/*
 * <AgentConstellation> — the agent, drawn; strength you can read;
 * bundles you can enter.
 *
 * Two navigation levels:
 *
 *   AGENT VIEW — rings inside → out:
 *      core      identity
 *      BRAIN     tight static diamond ring, model on the ring
 *      SKILLS    stadium field of SKILL ARTIFACTS: hub + label at
 *                the INNER edge, rows radiating outward —
 *                depth = skill count, brightness decays rimward,
 *                hollow outer rows = prerequisites not live here
 *      MEMORY    teal pool ring: the seeded workspace docs
 *                (SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md) each
 *                as their own node, plus knowledge bases
 *      TOOLS     amber hexes, slow orbit
 *      TEAM      blue outermost
 *
 *   BUNDLE VIEW — click a meta-pack/bundle and the ORBIT ITSELF
 *   becomes the bundle: its member packs render as stadium wedges
 *   with their own depths; the core shows the bundle with a back
 *   affordance. Same grammar, one level down.
 *
 * Color families are deliberately disjoint: skills magenta/violet,
 * memory teal/green, tools amber, team blue, brain ember. Every
 * drill panel opens with a LOCATOR saying where the thing sits.
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
  kind: 'workspace-doc' | 'kb';
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
  | { kind: 'member'; bundle: string; name: string }
  | { kind: 'tool'; name: string }
  | { kind: 'memory'; name: string }
  | { kind: 'team' }
  | null;

type Focus = { level: 'agent' } | { level: 'bundle'; name: string };

const W = 640;
const C = W / 2;
const PANEL_H = 600;

const R_BRAIN_IN = 56;
const R_BRAIN_OUT = 68;
const R_HUB = 92; // artifact hubs sit HERE — the inner edge
const R_FIELD_IN = 106;
const R_FIELD_OUT = 226;
const R_MEMORY = 250;
const R_TOOLS = 276;
const R_TEAM = 300;

// Disjoint hue families.
const SKILL_HUES = [265, 300, 330, 285, 315, 250];
export const packHue = (idx: number) => SKILL_HUES[idx % SKILL_HUES.length];
const MEM_HUES = [165, 185, 150, 200, 172];
const HUE_BRAIN = 18;
const HUE_TOOLS = 33;
const HUE_TEAM = 210;
const HUE_MEM = 170;

const RING_ORDER = ['CORE', 'BRAIN', 'SKILLS', 'MEMORY', 'TOOLS', 'TEAM'];
const ringLoc = (ring: string) => `${ring} · ring ${RING_ORDER.indexOf(ring) + 1} of ${RING_ORDER.length}`;

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
};

const dimWhenUnselected = (sel: Sel, mine: boolean) => (sel && !mine ? 0.25 : 1);

/** Stadium rows radiating OUTWARD from the field's inner edge. */
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
    const t = row / Math.max(rows - 1, 1);
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

const Locator: React.FC<{ text: string; hue: number }> = ({ text, hue }) => (
  <div
    style={{
      display: 'inline-block',
      background: `hsl(${hue} 60% 20%)`,
      border: `1px solid hsl(${hue} 70% 45%)`,
      color: `hsl(${hue} 85% 78%)`,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 10.5,
      letterSpacing: 1,
      marginBottom: 8,
    }}
  >
    ⌖ {text}
  </div>
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
      <div style={{ width: `${Math.round(depth01 * readiness01 * 100)}%`, background: `hsl(${hue} 80% 62%)` }} />
      <div style={{ width: `${Math.round(depth01 * (1 - readiness01) * 100)}%`, background: `hsl(${hue} 35% 35%)` }} />
    </div>
  </div>
);

const skillDepth = (s: ConstellationSkill, maxLeaves: number) =>
  Math.max(0.18, s.leaves.length / Math.max(maxLeaves, 1));
const skillReadiness = (s: ConstellationSkill) =>
  s.depsTotal === 0 ? 1 : Math.max(0.15, (s.depsTotal - s.depsUnmet.length) / s.depsTotal);

interface PanelExtra {
  sel: Sel;
  focus: Focus;
  onClose: () => void;
  onEnterBundle: (name: string) => void;
  onBack: () => void;
}

const DrillPanel: React.FC<ConstellationProps & PanelExtra> = props => {
  const { sel, focus } = props;
  const maxLeaves = Math.max(...props.skills.map(s => s.leaves.length), 1);

  const close = (
    <button
      onClick={props.onClose}
      style={{ float: 'right', background: 'none', border: 'none', color: '#8f86ad', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
      aria-label="close details"
    >
      ×
    </button>
  );

  if (!sel) {
    if (focus.level === 'bundle') {
      const b = props.skills.find(s => s.name === focus.name);
      return (
        <div style={panelStyles}>
          <Locator text={`INSIDE ${(b?.displayName || focus.name).toUpperCase()}`} hue={b?.hue ?? 265} />
          <p style={{ lineHeight: 1.5, color: '#b9b1d6' }}>
            You are inside the bundle. Each wedge is a member pack, depth = its
            skill count. Click a wedge for its skills; click the core (or ◀
            AGENT) to zoom back out.
          </p>
          <PLabel>MEMBERS</PLabel>
          {(b?.tree ?? []).map(t => (
            <div key={t.pack} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
              <span>{t.pack}</span>
              <span style={{ color: '#8f86ad' }}>{t.skills.length}</span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div style={panelStyles}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#8f86ad' }}>CONSTELLATION</div>
        <p style={{ marginTop: 8, lineHeight: 1.5, color: '#b9b1d6' }}>
          Click anything to drill in. Skill-artifact hubs sit at the base of
          their stands; rows climb outward with knowledge, hollow rim dots are
          not yet live here. Bundles (meta-packs) open into their own orbit.
        </p>
        <PLabel>STRENGTH — SKILL ARTIFACTS</PLabel>
        {props.skills.length === 0 && <p style={{ color: '#8f86ad', fontSize: 12 }}>None selected yet.</p>}
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
          <br />🗂 {props.memory.length} memory item(s) · 🔧 {props.tools.length} tool(s)
          <br />👥 {props.team ? `${props.team.gateway}${props.team.isNew ? ' (new team)' : ''}` : 'no team yet'}
        </p>
      </div>
    );
  }

  if (sel.kind === 'core') {
    return (
      <div style={panelStyles}>
        {close}
        <Locator text={ringLoc('CORE')} hue={30} />
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
        <Locator text={ringLoc('BRAIN')} hue={HUE_BRAIN} />
        <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${HUE_BRAIN} 90% 70%)` }}>Brain</div>
        <PLabel>CONNECTION</PLabel>
        <div>{props.brain.connection || '—'}</div>
        {props.brain.description && (
          <div style={{ color: '#b9b1d6', fontSize: 12, marginTop: 2 }}>{props.brain.description}</div>
        )}
        <PLabel>MODEL</PLabel>
        <div>
          {props.brain.models.map(m => (
            <Chip key={m.id} hue={m.id === props.brain.chosen ? HUE_BRAIN : 250}>
              {m.id === props.brain.chosen ? '● ' : ''}
              {m.name || m.id}
            </Chip>
          ))}
        </div>
        <p style={{ color: '#8f86ad', fontSize: 11, marginTop: 10 }}>
          Change it in the Brain section below. This ring never rotates — it is
          the agent's center of gravity.
        </p>
      </div>
    );
  }

  if (sel.kind === 'skill') {
    const idx = props.skills.findIndex(x => x.name === sel.name);
    const s = props.skills[idx];
    if (!s) return null;
    const readiness = skillReadiness(s);
    const isBundle = (s.tree?.length ?? 0) > 1 || s.artifactKind === 'meta-pack';
    const deepest = s.leaves.length === maxLeaves;
    return (
      <div style={panelStyles}>
        {close}
        <Locator text={`${ringLoc('SKILLS')} · wedge ${idx + 1}/${props.skills.length} · hub at inner edge`} hue={s.hue} />
        <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${s.hue} 85% 72%)` }}>
          {s.displayName || s.name}
        </div>
        <div style={{ color: '#8f86ad', fontSize: 11 }}>
          skill artifact · {s.artifactKind || 'skill'}
          {s.version ? ` · v${s.version}` : ''}
          {s.tier ? ` · tier: ${s.tier}` : ''}
          {s.installed === false ? ` · installs from ${s.registry || 'registry'} on create` : ''}
        </div>
        <PLabel>STRENGTH — WHY THIS SIZE</PLabel>
        <StrengthBar hue={s.hue} depth01={skillDepth(s, maxLeaves)} readiness01={readiness} />
        <div style={{ fontSize: 11, color: '#8f86ad', marginTop: 4 }}>
          {s.leaves.length} skill(s){deepest ? ' — the deepest artifact on this agent' : ` of max ${maxLeaves}`} ·{' '}
          {Math.round(readiness * 100)}% of prerequisites live on this cluster
        </div>
        {isBundle && (
          <button
            onClick={() => props.onEnterBundle(s.name)}
            style={{
              marginTop: 10,
              background: `hsl(${s.hue} 60% 22%)`,
              border: `1px solid hsl(${s.hue} 70% 50%)`,
              color: `hsl(${s.hue} 85% 80%)`,
              borderRadius: 6,
              padding: '5px 12px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ⤵ Enter bundle — view its orbit
          </button>
        )}
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

  if (sel.kind === 'member') {
    const b = props.skills.find(x => x.name === sel.bundle);
    const t = b?.tree.find(x => x.pack === sel.name);
    if (!b || !t) return null;
    const idx = b.tree.findIndex(x => x.pack === sel.name);
    return (
      <div style={panelStyles}>
        {close}
        <Locator
          text={`INSIDE ${(b.displayName || b.name).toUpperCase()} · wedge ${idx + 1}/${b.tree.length}`}
          hue={b.hue}
        />
        <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${b.hue} 85% 72%)` }}>{t.pack}</div>
        <div style={{ color: '#8f86ad', fontSize: 11 }}>member pack of {b.displayName || b.name}</div>
        <PLabel>SKILLS ({t.skills.length})</PLabel>
        {t.skills.map(l => (
          <div key={l.name} style={{ fontSize: 12, color: '#b9b1d6', marginTop: 2 }}>
            • {l.name}
            {l.installed ? ' ✓' : ''}
          </div>
        ))}
        <button
          onClick={props.onBack}
          style={{
            marginTop: 12,
            background: 'none',
            border: '1px solid #4a3f7d',
            color: '#b9b1d6',
            borderRadius: 6,
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ◀ Back to agent
        </button>
      </div>
    );
  }

  if (sel.kind === 'tool') {
    const idx = props.tools.findIndex(x => x.name === sel.name);
    const t = props.tools[idx];
    if (!t) return null;
    return (
      <div style={panelStyles}>
        {close}
        <Locator text={`${ringLoc('TOOLS')} · hex ${idx + 1}/${props.tools.length}`} hue={HUE_TOOLS} />
        <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${HUE_TOOLS} 90% 70%)` }}>{t.name}</div>
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
          Tools arrive with their skill artifacts — remove the artifact to drop
          its tools.
        </p>
      </div>
    );
  }

  if (sel.kind === 'memory') {
    const idx = props.memory.findIndex(x => x.name === sel.name);
    const m = props.memory[idx];
    if (!m) return null;
    return (
      <div style={panelStyles}>
        {close}
        <Locator text={`${ringLoc('MEMORY')} · node ${idx + 1}/${props.memory.length}`} hue={HUE_MEM} />
        <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${HUE_MEM} 75% 65%)` }}>{m.name}</div>
        <div style={{ color: '#8f86ad', fontSize: 11 }}>
          {m.kind === 'workspace-doc' ? 'seeded workspace document' : 'knowledge base'}
        </div>
        <PLabel>{m.kind === 'workspace-doc' ? 'WHAT IT HOLDS' : 'ROLE'}</PLabel>
        <div style={{ color: '#b9b1d6', fontSize: 12, whiteSpace: 'pre-wrap' }}>{m.detail}</div>
        {m.from && (
          <>
            <PLabel>CONTRIBUTED BY</PLabel>
            <Chip hue={265}>{m.from}</Chip>
          </>
        )}
        <PLabel>GROWS LIVE</PLabel>
        <p style={{ color: '#8f86ad', fontSize: 11, lineHeight: 1.5 }}>
          Memory is small at hire — just these seeds. It earns the stadium
          treatment in the live agent view as it accrues.
        </p>
      </div>
    );
  }

  return (
    <div style={panelStyles}>
      {close}
      <Locator text={ringLoc('TEAM')} hue={HUE_TEAM} />
      <div style={{ fontWeight: 700, fontSize: 15, color: `hsl(${HUE_TEAM} 80% 70%)` }}>{props.team?.gateway}</div>
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
        <Chip key={m} hue={HUE_TEAM}>
          {m}
        </Chip>
      ))}
    </div>
  );
};

/* ---------- the constellation ---------- */

export const AgentConstellation: React.FC<ConstellationProps> = props => {
  const { emoji, name, brain, skills, tools, memory, team } = props;
  const [sel, setSel] = React.useState<Sel>(null);
  const [focus, setFocus] = React.useState<Focus>({ level: 'agent' });

  const pick = (s: Exclude<Sel, null>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSel(cur => (JSON.stringify(cur) === JSON.stringify(s) ? null : s));
  };
  const enterBundle = (bundleName: string) => {
    setFocus({ level: 'bundle', name: bundleName });
    setSel(null);
  };
  const back = () => {
    setFocus({ level: 'agent' });
    setSel(null);
  };

  const maxLeaves = Math.max(...skills.map(s => s.leaves.length), 1);

  const wedgeLayout = (n: number, gapDeg: number) => {
    const span = n ? (360 - gapDeg * n) / n : 0;
    return Array.from({ length: n }, (_, i) => ({
      a0: -90 + gapDeg / 2 + i * (span + gapDeg),
      a1: -90 + gapDeg / 2 + i * (span + gapDeg) + span,
    }));
  };

  const bundle = focus.level === 'bundle' ? skills.find(s => s.name === focus.name) : undefined;

  const toolNodes = tools.slice(0, 14);
  const crew = team?.members?.slice(0, 8) ?? [];

  /** Hub node + label rendered at the INNER edge of a wedge. */
  const Hub: React.FC<{
    mid: number;
    hue: number;
    label: string;
    count: number;
    hasUnlit?: boolean;
  }> = ({ mid, hue, label, count, hasUnlit }) => {
    const p = polar(R_HUB, mid);
    const lp = polar(R_HUB - 16, mid);
    return (
      <g filter="url(#aoc-glow)">
        <circle cx={p.x} cy={p.y} r={6.5} fill={`hsl(${hue} 80% 60%)`} opacity={0.95} />
        <text
          x={lp.x}
          y={lp.y + 3}
          textAnchor="middle"
          fontSize={8.6}
          fontWeight={700}
          letterSpacing={0.5}
          fill={`hsl(${hue} 85% 80%)`}
        >
          {label.toUpperCase().slice(0, 14)}
        </text>
        <text x={p.x} y={p.y + 16} textAnchor="middle" fontSize={8} fill={`hsl(${hue} 60% 68%)`}>
          {count}
          {hasUnlit ? ' ◌' : ''}
        </text>
      </g>
    );
  };

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
              <path d="M6.5 0 L19.5 0 L26 11 L19.5 22 L6.5 22 L0 11 Z" fill="none" stroke="#2a2545" strokeWidth="0.5" opacity="0.5" />
            </pattern>
          </defs>

          <circle cx={C} cy={C} r={306} fill="url(#aoc-hex)" opacity={0.5} />

          {focus.level === 'agent' && (
            <>
              {/* TEAM */}
              <g opacity={dimWhenUnselected(sel, sel?.kind === 'team')}>
                <g className="aoc-slower">
                  <circle cx={C} cy={C} r={R_TEAM} fill="none" stroke={`hsl(${HUE_TEAM} 70% 55%)`} strokeWidth={1} opacity={0.5} strokeDasharray="1 6" />
                  {crew.map((m, i) => {
                    const { x, y } = polar(R_TEAM, (360 / Math.max(crew.length, 1)) * i + 18);
                    return (
                      <g key={`crew-${m}`} filter="url(#aoc-glow)" className="aoc-hit" onClick={pick({ kind: 'team' })}>
                        <title>{m}</title>
                        <path d={`M ${x - 11} ${y} l 5.5 -9.5 h 11 l 5.5 9.5 l -5.5 9.5 h -11 Z`} fill="#101426" stroke={`hsl(${HUE_TEAM} 80% 62%)`} strokeWidth={1.4} />
                        <text x={x} y={y + 4} textAnchor="middle" fontSize={9} fill={`hsl(${HUE_TEAM} 80% 78%)`}>
                          {m.slice(0, 2).toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </g>
                {team && (
                  <text className="aoc-hit" onClick={pick({ kind: 'team' })} x={C} y={C - R_TEAM - 8} textAnchor="middle" fontSize={11.5} fontWeight={700} letterSpacing={4} fill={`hsl(${HUE_TEAM} 80% 70%)`}>
                    TEAM · {team.gateway.toUpperCase()}
                    {team.isNew ? ' (NEW)' : ''}
                  </text>
                )}
              </g>

              {/* TOOLS */}
              <g opacity={dimWhenUnselected(sel, sel?.kind === 'tool')}>
                <g className="aoc-slow">
                  <circle cx={C} cy={C} r={R_TOOLS} fill="none" stroke={`hsl(${HUE_TOOLS} 80% 55%)`} strokeWidth={0.8} opacity={0.35} strokeDasharray="2 5" />
                  {toolNodes.map((t, i) => {
                    const { x, y } = polar(R_TOOLS, (360 / Math.max(toolNodes.length, 1)) * i);
                    return (
                      <g key={`tool-${t.name}`} filter="url(#aoc-glow)" className="aoc-hit" onClick={pick({ kind: 'tool', name: t.name })}>
                        <title>{t.name}</title>
                        <path d={`M ${x - 10} ${y} l 5 -8.7 h 10 l 5 8.7 l -5 8.7 h -10 Z`} fill="#161022" stroke={`hsl(${HUE_TOOLS} 90% 60%)`} strokeWidth={1.3} />
                        <text x={x} y={y + 3.5} textAnchor="middle" fontSize={8.5} fill={`hsl(${HUE_TOOLS} 90% 75%)`}>
                          {t.name.slice(0, 2).toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </g>

              {/* MEMORY — teal family, individual docs + KBs */}
              <g opacity={dimWhenUnselected(sel, sel?.kind === 'memory')}>
                <circle cx={C} cy={C} r={R_MEMORY} fill="none" stroke={`hsl(${HUE_MEM} 55% 45%)`} strokeWidth={0.7} opacity={0.4} />
                <RingLabel r={R_MEMORY + 6} text={memory.length ? 'MEMORY' : ''} hue={HUE_MEM} id="aoc-mem-ring" />
                {memory.slice(0, 12).map((m, i) => {
                  const hue = MEM_HUES[i % MEM_HUES.length];
                  const mine = sel?.kind === 'memory' && sel.name === m.name;
                  const deg = (360 / Math.max(memory.length, 1)) * i + 30;
                  const { x, y } = polar(R_MEMORY, deg);
                  const isDoc = m.kind === 'workspace-doc';
                  return (
                    <g key={`mem-${m.name}`} className="aoc-hit" onClick={pick({ kind: 'memory', name: m.name })} opacity={dimWhenUnselected(sel, mine || sel?.kind !== 'memory')} filter="url(#aoc-glow)">
                      <title>{m.name}</title>
                      {isDoc ? (
                        <rect x={x - 7} y={y - 8.5} width={14} height={17} rx={2} fill="#0d1a17" stroke={`hsl(${hue} 70% 58%)`} strokeWidth={1.3} />
                      ) : (
                        <>
                          <circle cx={x} cy={y} r={8} fill="#0d1a17" stroke={`hsl(${hue} 75% 58%)`} strokeWidth={1.4} />
                          <circle cx={x} cy={y} r={12} fill="none" stroke={`hsl(${hue} 75% 58%)`} strokeWidth={0.6} opacity={0.5} />
                        </>
                      )}
                      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={7.5} fill={`hsl(${hue} 80% 75%)`}>
                        {m.name.replace('.md', '').slice(0, 2).toUpperCase()}
                      </text>
                    </g>
                  );
                })}
              </g>

              {/* SKILLS — stadium field, hubs at the INNER edge */}
              <g opacity={dimWhenUnselected(sel, sel?.kind === 'skill')}>
                {skills.length > 0 &&
                  wedgeLayout(skills.length, 10).map(({ a0, a1 }, i) => {
                    const s = skills[i];
                    const mine = sel?.kind === 'skill' && sel.name === s.name;
                    const depth = skillDepth(s, maxLeaves);
                    const readiness = skillReadiness(s);
                    const { nodes, rows, litRows } = stadiumWedge(`w-${s.name}`, a0, a1, depth, readiness, s.hue, s.leaves);
                    return (
                      <g key={`seg-${s.name}`} className="aoc-hit" onClick={pick({ kind: 'skill', name: s.name })} opacity={dimWhenUnselected(sel, mine || sel?.kind !== 'skill')}>
                        {nodes}
                        <title>{`${s.displayName || s.name} · ${s.leaves.length} skill(s) · ${Math.round(readiness * 100)}% live`}</title>
                        <Hub mid={(a0 + a1) / 2} hue={s.hue} label={s.displayName || s.name} count={s.leaves.length} hasUnlit={litRows < rows} />
                      </g>
                    );
                  })}
              </g>

              {/* BRAIN */}
              <g opacity={dimWhenUnselected(sel, sel?.kind === 'brain')} className="aoc-hit" onClick={pick({ kind: 'brain' })}>
                <title>
                  {brain.label}
                  {brain.connection ? ` — ${brain.connection}` : ''}
                </title>
                {[R_BRAIN_OUT, R_BRAIN_IN].map((r, ringIdx) =>
                  Array.from({ length: ringIdx === 0 ? 26 : 18 }, (_, i) => {
                    const { x, y } = polar(r, (360 / (ringIdx === 0 ? 26 : 18)) * i);
                    return <rect key={`br-${r}-${i}`} x={x - 2.4} y={y - 2.4} width={4.8} height={4.8} transform={`rotate(45 ${x} ${y})`} fill={`hsl(${HUE_BRAIN} 95% 58%)`} opacity={0.9} />;
                  }),
                )}
                <RingLabel r={R_BRAIN_OUT + 11} text={`BRAIN · ${brain.label.toUpperCase().slice(0, 24)}`} hue={HUE_BRAIN} id="aoc-brain-ring" />
              </g>

              {/* core */}
              <g filter="url(#aoc-glow)" className="aoc-hit" onClick={pick({ kind: 'core' })} opacity={dimWhenUnselected(sel, sel?.kind === 'core')}>
                <title>{name}</title>
                <circle className="aoc-core" cx={C} cy={C} r={26} fill="#1c1428" stroke="hsl(30 90% 60%)" strokeWidth={1.6} />
                <text x={C} y={C + 7} textAnchor="middle" fontSize={20}>
                  {emoji || '🤖'}
                </text>
              </g>
              <text x={C} y={C + 42} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing={2} fill="#f2ecff">
                {(name || 'AGENT').toUpperCase()}
              </text>
            </>
          )}

          {focus.level === 'bundle' && bundle && (
            <>
              {/* BUNDLE VIEW — members as stadium wedges */}
              {(() => {
                const members = bundle.tree;
                const maxM = Math.max(...members.map(t => t.skills.length), 1);
                return wedgeLayout(members.length, 12).map(({ a0, a1 }, i) => {
                  const t = members[i];
                  const mine = sel?.kind === 'member' && sel.name === t.pack;
                  const depth = Math.max(0.18, t.skills.length / maxM);
                  const { nodes } = stadiumWedge(
                    `m-${t.pack}`,
                    a0,
                    a1,
                    depth,
                    1,
                    SKILL_HUES[i % SKILL_HUES.length],
                    t.skills.map(x => x.name),
                  );
                  return (
                    <g key={`mseg-${t.pack}`} className="aoc-hit" onClick={pick({ kind: 'member', bundle: bundle.name, name: t.pack })} opacity={dimWhenUnselected(sel, mine || sel?.kind !== 'member')}>
                      {nodes}
                      <title>{`${t.pack} · ${t.skills.length} skill(s)`}</title>
                      <Hub mid={(a0 + a1) / 2} hue={SKILL_HUES[i % SKILL_HUES.length]} label={t.pack.replace(/^.*?-/, '')} count={t.skills.length} />
                    </g>
                  );
                });
              })()}
              {/* bundle core = back */}
              <g filter="url(#aoc-glow)" className="aoc-hit" onClick={e => (e.stopPropagation(), back())}>
                <title>back to agent</title>
                <circle className="aoc-core" cx={C} cy={C} r={30} fill="#1c1428" stroke={`hsl(${bundle.hue} 85% 60%)`} strokeWidth={1.8} />
                <text x={C} y={C - 2} textAnchor="middle" fontSize={13} fill={`hsl(${bundle.hue} 85% 80%)`}>
                  ◀
                </text>
                <text x={C} y={C + 12} textAnchor="middle" fontSize={7.5} fill="#8f86ad">
                  AGENT
                </text>
              </g>
              <text x={C} y={C + 52} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing={2} fill={`hsl(${bundle.hue} 85% 78%)`}>
                {(bundle.displayName || bundle.name).toUpperCase()}
              </text>
              <text x={C} y={C + 66} textAnchor="middle" fontSize={8.5} fill="#8f86ad">
                BUNDLE · {bundle.tree.length} MEMBER PACKS
              </text>
            </>
          )}
        </svg>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '6px 0 2px', fontSize: 10.5, letterSpacing: 1, color: '#8f86ad', flexWrap: 'wrap' }}>
          {focus.level === 'agent' ? (
            <>
              <span style={{ color: `hsl(${HUE_BRAIN} 90% 66%)` }}>◆ BRAIN</span>
              <span style={{ color: 'hsl(285 80% 74%)' }}>● SKILL ARTIFACTS — rows out = depth, hollow rim = not live</span>
              <span style={{ color: `hsl(${HUE_MEM} 70% 65%)` }}>▤ MEMORY</span>
              <span style={{ color: `hsl(${HUE_TOOLS} 90% 66%)` }}>⬡ TOOLS</span>
              <span style={{ color: `hsl(${HUE_TEAM} 80% 68%)` }}>⬢ TEAM</span>
            </>
          ) : (
            <span>
              ◀ inside {(bundle?.displayName || bundle?.name || '').toUpperCase()} — click the core to
              return to the agent
            </span>
          )}
        </div>
      </div>
      <DrillPanel {...props} sel={sel} focus={focus} onClose={() => setSel(null)} onEnterBundle={enterBundle} onBack={back} />
    </div>
  );
};

export default AgentConstellation;
