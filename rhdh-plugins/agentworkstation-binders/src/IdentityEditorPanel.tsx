/*
 * <IdentityEditorPanel>
 *
 * Edits the AW fields that define agent uniqueness — the per-agent
 * always-on context every conversation starts with:
 *
 *   IDENTITY.md ← spec.displayName + spec.role + spec.capabilities + spec.emoji
 *   SOUL.md     ← spec.systemPrompt
 *
 * These are the "bound" parts of the agent in the v1.6.0 model.
 * Everything else (skills, memories, KB content) is discovered or
 * file-read at runtime.
 *
 * Save composes a full updated AW YAML with the edited fields and
 * fires the same publish:github:pull-request scaffolder action the
 * KB tab uses. PR merge → ArgoCD sync → operator re-renders SOUL.md
 * and IDENTITY.md into every agent pod that uses this AW.
 *
 * Markdown preview / WYSIWYG: deferred. The SOUL editor is a plain
 * monospace textarea today; future iteration can pull in a real
 * markdown editor (react-md-editor or similar) when the friction
 * is real enough to justify the bundle weight.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  TextField,
  Typography,
} from '@material-ui/core';
import yaml from 'js-yaml';
import { useProxiedK8s } from './strategies/useProxiedK8s';
import { useScaffolderPR } from './strategies/useScaffolderPR';

interface AwSpec {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec: {
    displayName?: string;
    role?: string;
    capabilities?: string[];
    emoji?: string;
    systemPrompt?: string;
    // Everything else preserved verbatim on save (passed through
    // unchanged so we don't accidentally drop fields we don't know
    // about — e.g. spec.runtime, spec.tools, spec.knowledgeBaseRefs).
    [k: string]: unknown;
  };
}

interface GitopsSource {
  repoUrl: string;
  filePath: string;
  defaultBranch: string;
}

interface IdentityEditorPanelProps {
  awName: string;
  awNamespace: string;
}

export const IdentityEditorPanel: React.FC<IdentityEditorPanelProps> = ({
  awName,
  awNamespace,
}) => {
  const { get } = useProxiedK8s();
  const openPR = useScaffolderPR();

  // Loaded state
  const [aw, setAw] = useState<AwSpec | null>(null);
  const [gitops, setGitops] = useState<GitopsSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();

  // Editable state — initialized from the loaded AW. We keep these
  // as separate useState rather than mutating `aw` so the "dirty"
  // detection (has the user changed anything?) is straightforward.
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [capabilitiesText, setCapabilitiesText] = useState('');
  const [emoji, setEmoji] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  // Load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [awSpec, gitopsSrc] = await Promise.all([
          get<AwSpec>(`/namespaces/${awNamespace}/agentworkstations/${awName}`),
          get<GitopsSource>(
            `/namespaces/${awNamespace}/agentworkstations/${awName}/gitops-source`,
          ),
        ]);
        if (cancelled) return;
        setAw(awSpec);
        setGitops(gitopsSrc);
        setDisplayName(awSpec.spec.displayName ?? '');
        setRole(awSpec.spec.role ?? '');
        setCapabilitiesText((awSpec.spec.capabilities ?? []).join(', '));
        setEmoji(awSpec.spec.emoji ?? '');
        setSystemPrompt(awSpec.spec.systemPrompt ?? '');
        setLoadError(undefined);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            (err as Error).message +
              ' — most commonly: this entity has no matching AgentWorkstation CR. ' +
              'Set the `agentoffice.ai/agentworkstation-name` annotation on the entity ' +
              'to point at the AW you want to edit.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awName, awNamespace, get]);

  // Track whether the user has changed anything; disables Save when
  // there's no diff to ship.
  const dirty = useMemo(() => {
    if (!aw) return false;
    const origCaps = (aw.spec.capabilities ?? []).join(', ');
    return (
      displayName !== (aw.spec.displayName ?? '') ||
      role !== (aw.spec.role ?? '') ||
      capabilitiesText !== origCaps ||
      emoji !== (aw.spec.emoji ?? '') ||
      systemPrompt !== (aw.spec.systemPrompt ?? '')
    );
  }, [aw, displayName, role, capabilitiesText, emoji, systemPrompt]);

  const onSave = async () => {
    if (!aw || !gitops) return;
    setSaving(true);
    setSaveError(undefined);
    setSaved(false);
    try {
      // Compose the updated spec — preserve every other field
      // verbatim. Capabilities from the comma-separated text input.
      const caps = capabilitiesText
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      const updatedSpec = {
        ...aw.spec,
        displayName: displayName || undefined,
        role: role || undefined,
        capabilities: caps.length > 0 ? caps : undefined,
        emoji: emoji || undefined,
        systemPrompt: systemPrompt || undefined,
      };

      const newContent = yaml.dump({
        apiVersion: aw.apiVersion ?? 'agentoffice.ai/v1alpha1',
        kind: aw.kind ?? 'AgentWorkstation',
        metadata: {
          name: awName,
          namespace: awNamespace,
          ...(aw.metadata?.annotations
            ? { annotations: aw.metadata.annotations }
            : {}),
          ...(aw.metadata?.labels ? { labels: aw.metadata.labels } : {}),
        },
        spec: updatedSpec,
      });

      await openPR({
        awName,
        awNamespace,
        bindingType: 'identity',
        targetPath: gitops.filePath,
        newContent,
        branchName: `aw-binder/${awName}-identity-${Date.now()}`,
        title: `${awName}: update identity & system prompt`,
        body: [
          `Updates the always-on identity fields on AgentWorkstation \`${awName}\`:`,
          '',
          `- displayName: ${displayName ? `\`${displayName}\`` : '(cleared)'}`,
          `- role: ${role ? `\`${role}\`` : '(cleared)'}`,
          `- emoji: ${emoji ? emoji : '(cleared)'}`,
          `- capabilities: ${
            caps.length > 0 ? caps.map(c => `\`${c}\``).join(', ') : '(cleared)'
          }`,
          `- systemPrompt: ${systemPrompt.length} chars`,
          '',
          'Generated by the agentworkstation-binders Backstage plugin ' +
            '(Identity tab). On merge, ArgoCD syncs and the operator ' +
            're-renders SOUL.md + IDENTITY.md into every agent pod ' +
            'that uses this AW.',
        ].join('\n'),
      });
      setSaved(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" my={3}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box my={2}>
        <Typography color="error" variant="body2">
          {loadError}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box mb={2}>
        <Typography variant="body2" color="textSecondary">
          The always-on identity for {awName}. These fields define what
          the agent IS — its name, role, personality, and the system prompt
          loaded at the start of every conversation. Save opens a PR against
          the gitops repo; merge syncs through ArgoCD and the operator
          re-renders SOUL.md + IDENTITY.md into the agent's workspace.
        </Typography>
      </Box>

      <Typography variant="subtitle1" gutterBottom>
        Identity (renders to IDENTITY.md)
      </Typography>
      <Box display="flex" gridGap={12} mb={2}>
        <TextField
          label="Display name"
          variant="outlined"
          size="small"
          fullWidth
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          helperText="Human-readable name shown in the Dev Hub catalog + Discord/etc bindings"
        />
        <TextField
          label="Emoji"
          variant="outlined"
          size="small"
          style={{ width: 120 }}
          value={emoji}
          onChange={e => setEmoji(e.target.value)}
          helperText="Optional"
        />
      </Box>
      <Box display="flex" gridGap={12} mb={2}>
        <TextField
          label="Role"
          variant="outlined"
          size="small"
          fullWidth
          value={role}
          onChange={e => setRole(e.target.value)}
          helperText="Short role label (e.g. pm, developer, researcher, experimenter)"
        />
      </Box>
      <Box mb={3}>
        <TextField
          label="Capabilities"
          variant="outlined"
          size="small"
          fullWidth
          value={capabilitiesText}
          onChange={e => setCapabilitiesText(e.target.value)}
          helperText="Comma-separated capability tags the PM Agent uses when planning. E.g. project-intake, task-decomposition, agent-inventory"
        />
      </Box>

      <Divider />

      <Box mt={3}>
        <Typography variant="subtitle1" gutterBottom>
          System prompt (renders to SOUL.md)
        </Typography>
        <TextField
          variant="outlined"
          fullWidth
          multiline
          minRows={12}
          maxRows={30}
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          inputProps={{
            style: { fontFamily: 'monospace', fontSize: 13 },
          }}
          helperText={`${systemPrompt.length} characters. Markdown supported; rendered into the agent's SOUL.md at /home/node/.openclaw/workspaces/${awName}/SOUL.md.`}
        />
      </Box>

      <Box mt={3} display="flex" alignItems="center" gridGap={16}>
        <Button
          variant="contained"
          color="primary"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? 'Opening PR…' : 'Save (opens PR)'}
        </Button>
        {!dirty && !saved && !saveError && (
          <Typography variant="caption" color="textSecondary">
            No changes to save.
          </Typography>
        )}
        {saved && !saving && (
          <Typography variant="caption" style={{ color: 'green' }}>
            ✓ PR opened. Check the gitops repo.
          </Typography>
        )}
        {saveError && (
          <Typography variant="caption" color="error">
            {saveError}
          </Typography>
        )}
      </Box>
    </Box>
  );
};
