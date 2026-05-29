/*
 * <SkillCatalogPanel>
 *
 * Read-only browser of the runtime skill catalog (v1.6.0).
 *
 * Replaces the v0.0.3 drag-drop Skills tab. The architectural shift:
 * skills are no longer BOUND to agents via the binders plugin —
 * every agent sees the full local catalog rendered into its
 * workspace, and the runtime decides at runtime which skills to use
 * via progressive disclosure (Anthropic Skills Open Standard).
 *
 * The binders plugin's role for skills shrinks to "informational
 * browse" — show the user what skills are available on the cluster,
 * with provenance (tier, source repo) and per-skill metadata. The
 * agent picks at runtime; the human just gets visibility.
 *
 * Detail-view (modal showing the full SKILL.md body when a row is
 * clicked) is a follow-up; this slice is just the list.
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Link as MuiLink,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import SearchIcon from '@material-ui/icons/Search';
import OpenInNewIcon from '@material-ui/icons/OpenInNew';
import { useCatalogClient, CatalogSkillEntry } from './strategies/useCatalogClient';

const TIER_COLORS: Record<string, 'primary' | 'secondary' | 'default'> = {
  'rh-official': 'primary',
  'anthropic-official': 'secondary',
  community: 'default',
  'customer-authored': 'default',
};

export const SkillCatalogPanel: React.FC = () => {
  const catalog = useCatalogClient();
  const [skills, setSkills] = useState<CatalogSkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const result = await catalog.listSkills({ query });
        if (!cancelled) {
          setSkills(result.items);
          setErrorMessage(undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            (err as Error).message +
              ' — the operator /catalog/skills endpoint may not yet be deployed (requires operator v1.6.0+).',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-fetch when the query changes. catalog.listSkills is memoized
    // (see useCatalogClient) so the reference is stable across
    // re-renders — no infinite loop.
  }, [catalog, query]);

  return (
    <Box>
      <Box mb={2}>
        <Typography variant="body2" color="textSecondary">
          Read-only browser of the runtime skill catalog. Skills are no longer
          bound to agents via this plugin — every agent sees the full catalog
          rendered into its workspace and the runtime picks at runtime via
          progressive disclosure. Use this panel for visibility into what's
          available; use the importer pipeline + gitops to add or remove
          catalog entries.
        </Typography>
      </Box>

      <Box mb={2}>
        <TextField
          fullWidth
          variant="outlined"
          size="small"
          placeholder="Search skills by name or description…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {loading && (
        <Box display="flex" justifyContent="center" my={3}>
          <CircularProgress size={28} />
        </Box>
      )}

      {!loading && errorMessage && (
        <Box my={2}>
          <Typography color="error" variant="body2">
            {errorMessage}
          </Typography>
        </Box>
      )}

      {!loading && !errorMessage && skills.length === 0 && (
        <Box my={2}>
          <Typography variant="body2" color="textSecondary">
            No skills found in the catalog
            {query ? ` matching "${query}"` : ''}.
            {!query &&
              ' Run the skill-importer pipeline (cluster/skill-importer/) ' +
                'to populate the catalog with upstream skills, or add ' +
                'Skill CRs directly via gitops.'}
          </Typography>
        </Box>
      )}

      {!loading && !errorMessage && skills.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Tier</TableCell>
                <TableCell>Version</TableCell>
                <TableCell>Source</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {skills.map(s => (
                <TableRow key={s.name}>
                  <TableCell>
                    <Typography variant="body2" component="span">
                      <strong>{s.displayName ?? s.name}</strong>
                    </Typography>
                    {s.displayName && s.displayName !== s.name && (
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        display="block"
                      >
                        {s.name}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="textSecondary">
                      {s.description ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {s.tier && (
                      <Chip
                        label={s.tier}
                        size="small"
                        color={TIER_COLORS[s.tier] ?? 'default'}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{s.version ?? '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    {s.sourceRepo ? (
                      <Tooltip
                        title={`${s.sourceRepo}${
                          s.sourceRevision ? ` @ ${s.sourceRevision}` : ''
                        }`}
                      >
                        <MuiLink
                          href={
                            s.sourceRepo.startsWith('http')
                              ? s.sourceRepo
                              : `https://github.com/${s.sourceRepo}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <IconButton size="small">
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </MuiLink>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="textSecondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};
