/*
 * <BindingPanel>
 *
 * The reusable drag-drop binding component. Three instances exist
 * in this plugin (KnowledgeBases, MemoryModules, Skills), each
 * wired with a different `strategy` that knows:
 *   - how to list "available" items
 *   - how to read the AW's currently-attached items
 *   - how to render each card
 *   - how to compute the YAML patch on Save
 *   - what the PR title/body should say
 *
 * Layout:
 *
 *   ┌──────────────────┬──────────────────┐
 *   │  AVAILABLE       │  ATTACHED        │
 *   │  (drag source)   │  (drop target)   │
 *   │  ┌────────────┐  │  ┌────────────┐  │
 *   │  │ KB A       │  │  │ KB X       │  │
 *   │  │ desc...    │  │  │ role: ...  │  │
 *   │  └────────────┘  │  └────────────┘  │
 *   │  ┌────────────┐  │  + (drop here)   │
 *   │  │ KB B       │  │                  │
 *   │  └────────────┘  │                  │
 *   │  ╳ (greyed)     │                  │
 *   │  KB C (cross-gw) │                  │
 *   └──────────────────┴──────────────────┘
 *   [ Save (opens PR) ]  [ Discard ]
 *
 * Drag-and-drop uses native HTML5 DnD (no react-dnd dep — keeps the
 * bundle small and avoids RHDH peer-dep churn). Greyed items can't
 * be dragged. Attached items render a (×) button to detach.
 *
 * Save fires the stock publish:github:pull-request scaffolder
 * action via the Backstage scaffolder API client. The strategy
 * provides the file path to edit + the YAML patch function.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import CloseIcon from '@material-ui/icons/Close';
import LockIcon from '@material-ui/icons/Lock';
import DragIndicatorIcon from '@material-ui/icons/DragIndicator';

/**
 * A single binding item, generic over the underlying resource type.
 * Strategies map their domain object onto this shape so the panel
 * stays resource-agnostic.
 */
export interface BindingItem {
  /** Resource name, used as the stable key. */
  name: string;
  /** Human-readable label shown on the card. */
  displayName: string;
  /** Optional one-line description shown below the label. */
  description?: string;
  /**
   * If true, the item is greyed out and not draggable. Set by
   * the strategy when something prevents attaching (e.g. KB is
   * on a different gateway than this agent).
   */
  disabled?: boolean;
  /**
   * Optional reason string surfaced as a tooltip on disabled items.
   */
  disabledReason?: string;
  /**
   * Optional per-binding "role" or similar enum value. When
   * present, the attached card renders a Select with these options.
   */
  roleOptions?: { value: string; label: string }[];
  /** Current selected role on an attached binding. */
  role?: string;
}

/**
 * The full strategy interface. Each binding type (KB / Memory /
 * Skill) provides one implementation. The panel is otherwise
 * resource-agnostic.
 */
export interface BindingStrategy {
  /** Short label for the panel header (e.g. "Knowledge Bases"). */
  resourceLabel: string;
  /** Items the user can drag in. Includes disabled ones. */
  available: BindingItem[];
  /** Items currently attached to the agent. */
  attached: BindingItem[];
  /** Called when Save is clicked with the new attached list. */
  onSave: (next: BindingItem[]) => Promise<void>;
  /** Loading state — disables Save while true. */
  saving?: boolean;
  /** If non-empty, rendered as an Alert above the panel. */
  errorMessage?: string;
  /** Disable Save entirely with this tooltip (e.g. "v1.6.0 will…"). */
  saveDisabledTooltip?: string;
}

const dragMimeType = 'application/x-agentworkstation-binding';

export const BindingPanel: React.FC<BindingStrategy> = ({
  resourceLabel,
  available,
  attached,
  onSave,
  saving = false,
  errorMessage,
  saveDisabledTooltip,
}) => {
  // Local working copy of the attached list. Edits apply here;
  // Save flushes to the strategy's onSave (PR open).
  const [working, setWorking] = useState<BindingItem[]>(attached);
  const [dirty, setDirty] = useState(false);

  // Re-sync when the parent's attached list changes (e.g. after
  // a Save completes and the AW spec re-resolves).
  React.useEffect(() => {
    setWorking(attached);
    setDirty(false);
  }, [attached]);

  const attachedNames = useMemo(
    () => new Set(working.map(a => a.name)),
    [working],
  );

  const handleDragStart = (e: React.DragEvent, item: BindingItem) => {
    if (item.disabled) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(dragMimeType, item.name);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropToAttached = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const name = e.dataTransfer.getData(dragMimeType);
      if (!name) return;
      // Already attached? no-op.
      if (attachedNames.has(name)) return;
      const item = available.find(a => a.name === name);
      if (!item) return;
      // Default role to the first roleOption if any.
      const defaulted: BindingItem = {
        ...item,
        role:
          item.roleOptions && item.roleOptions.length > 0
            ? item.roleOptions[0].value
            : undefined,
      };
      setWorking([...working, defaulted]);
      setDirty(true);
    },
    [attachedNames, available, working],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleRemove = (name: string) => {
    setWorking(working.filter(w => w.name !== name));
    setDirty(true);
  };

  const handleRoleChange = (name: string, role: string) => {
    setWorking(working.map(w => (w.name === name ? { ...w, role } : w)));
    setDirty(true);
  };

  const handleSave = async () => {
    await onSave(working);
    setDirty(false);
  };

  return (
    <Box>
      {errorMessage && (
        <Box mb={2}>
          <Alert severity="error">{errorMessage}</Alert>
        </Box>
      )}
      <Box display="flex" gridGap={16}>
        {/* LEFT: AVAILABLE */}
        <Paper variant="outlined" style={{ flex: 1, padding: 12 }}>
          <Typography variant="subtitle2" gutterBottom>
            Available {resourceLabel}
          </Typography>
          {available.length === 0 && (
            <Typography variant="body2" color="textSecondary">
              No {resourceLabel.toLowerCase()} found in this namespace.
            </Typography>
          )}
          {available.map(item => {
            const isAttached = attachedNames.has(item.name);
            const cardOpacity = item.disabled ? 0.4 : isAttached ? 0.5 : 1;
            return (
              <Tooltip
                key={item.name}
                title={
                  item.disabled
                    ? item.disabledReason ?? 'Unavailable'
                    : isAttached
                    ? 'Already attached'
                    : `Drag onto the agent to attach`
                }
              >
                <Card
                  variant="outlined"
                  draggable={!item.disabled && !isAttached}
                  onDragStart={e => handleDragStart(e, item)}
                  style={{
                    marginBottom: 8,
                    opacity: cardOpacity,
                    cursor:
                      item.disabled || isAttached ? 'not-allowed' : 'grab',
                  }}
                >
                  <CardContent style={{ padding: 12 }}>
                    <Box display="flex" alignItems="center" gridGap={8}>
                      {item.disabled ? (
                        <LockIcon fontSize="small" />
                      ) : (
                        <DragIndicatorIcon fontSize="small" />
                      )}
                      <Box flexGrow={1}>
                        <Typography variant="body2">
                          <strong>{item.displayName}</strong>{' '}
                          <Typography
                            variant="caption"
                            color="textSecondary"
                            component="span"
                          >
                            ({item.name})
                          </Typography>
                        </Typography>
                        {item.description && (
                          <Typography variant="caption" color="textSecondary">
                            {item.description}
                          </Typography>
                        )}
                      </Box>
                      {isAttached && <Chip label="attached" size="small" />}
                    </Box>
                  </CardContent>
                </Card>
              </Tooltip>
            );
          })}
        </Paper>

        {/* RIGHT: ATTACHED (drop zone) */}
        <Paper
          variant="outlined"
          onDragOver={handleDragOver}
          onDrop={handleDropToAttached}
          style={{ flex: 1, padding: 12, minHeight: 200 }}
        >
          <Typography variant="subtitle2" gutterBottom>
            Attached to this agent
          </Typography>
          {working.length === 0 && (
            <Typography variant="body2" color="textSecondary">
              Drag {resourceLabel.toLowerCase()} cards here to attach.
            </Typography>
          )}
          {working.map(item => (
            <Card key={item.name} variant="outlined" style={{ marginBottom: 8 }}>
              <CardContent style={{ padding: 12 }}>
                <Box display="flex" alignItems="center" gridGap={8}>
                  <Box flexGrow={1}>
                    <Typography variant="body2">
                      <strong>{item.displayName}</strong>{' '}
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        component="span"
                      >
                        ({item.name})
                      </Typography>
                    </Typography>
                    {item.description && (
                      <Typography variant="caption" color="textSecondary">
                        {item.description}
                      </Typography>
                    )}
                    {item.roleOptions && item.roleOptions.length > 0 && (
                      <Box mt={1}>
                        <FormControl size="small" variant="outlined">
                          <InputLabel>Role</InputLabel>
                          <Select
                            value={item.role ?? item.roleOptions[0].value}
                            onChange={e =>
                              handleRoleChange(
                                item.name,
                                e.target.value as string,
                              )
                            }
                            label="Role"
                            style={{ minWidth: 180 }}
                          >
                            {item.roleOptions.map(opt => (
                              <MenuItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Box>
                    )}
                  </Box>
                  <IconButton size="small" onClick={() => handleRemove(item.name)}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Paper>
      </Box>

      {/* SAVE BAR */}
      <Box mt={2} display="flex" justifyContent="flex-end" gridGap={8}>
        {dirty && (
          <Typography
            variant="caption"
            color="textSecondary"
            style={{ alignSelf: 'center' }}
          >
            Unsaved changes — Save opens a PR against the gitops repo.
          </Typography>
        )}
        <Tooltip title={saveDisabledTooltip ?? ''}>
          <span>
            <Button
              variant="contained"
              color="primary"
              onClick={handleSave}
              disabled={!dirty || saving || !!saveDisabledTooltip}
              startIcon={saving && <CircularProgress size={14} />}
            >
              {saving ? 'Opening PR…' : 'Save (open PR)'}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
};
