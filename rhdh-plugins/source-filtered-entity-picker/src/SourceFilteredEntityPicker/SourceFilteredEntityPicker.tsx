/*
 * SourceFilteredEntityPicker — a scaffolder field extension that
 * shows a typeahead picker for catalog entities alongside a filter-
 * icon popover that narrows the list by source annotation.
 *
 * Use case: the agent-office operator emits Backstage `Resource`
 * entities for every ml-model it knows about, tagged either
 * `model-registry` or `model-catalog` in `agentoffice.ai/model-
 * source`. The karpathy-research-agent template's `baseModel`
 * field uses this picker so workshop attendees can narrow the
 * dropdown by source with a single click on a filter icon.
 *
 * Implementation notes:
 * - Uses Material-UI Autocomplete directly rather than depending
 *   on Backstage's internal EntityPicker component (which moves
 *   between packages across versions and isn't on a stable public
 *   import path). All the catalog work happens via the public
 *   catalogApiRef.
 * - The value emitted to the form is a Backstage entity ref string
 *   (`<kind>:<namespace>/<name>`), matching what stock EntityPicker
 *   produces. Templates that consume the value with
 *   `entityRef: ${{ parameters.baseModel }}` will work unchanged.
 * - On first render with an existing value, we fetch the
 *   corresponding entity so the autocomplete shows the saved
 *   selection rather than the raw ref string.
 */

import React from 'react';
import { Entity, stringifyEntityRef, parseEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import Autocomplete from '@material-ui/lab/Autocomplete';
import FormControl from '@material-ui/core/FormControl';
import FormHelperText from '@material-ui/core/FormHelperText';
import TextField from '@material-ui/core/TextField';
import IconButton from '@material-ui/core/IconButton';
import Popover from '@material-ui/core/Popover';
import FormGroup from '@material-ui/core/FormGroup';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Checkbox from '@material-ui/core/Checkbox';
import Box from '@material-ui/core/Box';
import Typography from '@material-ui/core/Typography';
import Tooltip from '@material-ui/core/Tooltip';
import Chip from '@material-ui/core/Chip';
import Divider from '@material-ui/core/Divider';
// "Tune" is the three-sliders Material icon (rather than the
// FilterList triangle-stack). v0.0.4 swap so the button matches the
// affordance the user expects — a settings-sliders glyph reads as
// "open a filter panel" much more clearly than the small triangle.
import TuneIcon from '@material-ui/icons/Tune';
import { makeStyles } from '@material-ui/core/styles';
import { useAsync } from 'react-use';

const useStyles = makeStyles(theme => ({
  wrapper: {
    display: 'flex',
    // v0.0.4: center the filter button against the dropdown's input
    // row instead of top-aligning. The Autocomplete TextField uses a
    // floating label (variant="outlined"), so the whole control is
    // a single ~40px-tall input — center-aligning the IconButton
    // sits it nicely inline rather than below.
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
  },
  pickerColumn: {
    flex: 1,
    minWidth: 0,
  },
  filterButton: {
    // Nudged 1 unit down so the button visually balances with the
    // input row (FormControl margin="normal" adds a top margin that
    // pushes the input but not the button — this compensates).
    marginTop: theme.spacing(1),
    position: 'relative',
  },
  activeBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: theme.palette.secondary.main,
    color: theme.palette.secondary.contrastText,
    fontSize: 10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    padding: '0 4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popoverContent: {
    padding: theme.spacing(2),
    minWidth: 280,
  },
  countChip: {
    marginLeft: theme.spacing(1),
    height: 18,
    fontSize: 11,
  },
  emptyState: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
    paddingTop: theme.spacing(1),
  },
  clearLink: {
    cursor: 'pointer',
    userSelect: 'none',
  },
}));

type SourceOption = {
  value: string;
  label: string;
  count: number;
};

type CatalogFilter =
  | Record<string, string | string[]>
  | Record<string, string | string[]>[]
  | undefined;

type SourceFilteredEntityPickerOptions = {
  catalogFilter?: CatalogFilter;
  /**
   * Annotation name carrying the source identifier on each entity.
   * Defaults to `agentoffice.ai/model-source` — change this if you
   * embed this plugin into a context that names sources differently.
   */
  sourceAnnotation?: string;
  /**
   * Optional human-readable label overrides per source value, e.g.
   *   sourceLabels:
   *     model-registry: "Model Registry"
   *     model-catalog:  "Model Catalog"
   * Sources we encounter that aren't listed here fall back to the
   * raw annotation value.
   */
  sourceLabels?: Record<string, string>;
};

// Human label for an entity in the autocomplete dropdown. Prefer
// metadata.title (which the operator sets to include the [Registry]
// / [Catalog] prefix); fall back to the entity name.
function entityLabel(e: Entity): string {
  return e.metadata.title || e.metadata.name;
}

export const SourceFilteredEntityPicker = (
  props: FieldExtensionComponentProps<string>,
) => {
  const classes = useStyles();
  const catalogApi = useApi(catalogApiRef);

  const {
    onChange,
    formData,
    schema: { title = 'Entity', description },
    required,
    rawErrors,
    idSchema,
  } = props;

  const uiOptions =
    (props.uiSchema?.['ui:options'] ?? {}) as SourceFilteredEntityPickerOptions;
  const baseCatalogFilter = uiOptions.catalogFilter;
  const sourceAnnotation =
    uiOptions.sourceAnnotation ?? 'agentoffice.ai/model-source';
  const sourceLabels = uiOptions.sourceLabels ?? {
    'model-registry': 'Model Registry',
    'model-catalog': 'Model Catalog',
  };

  // null = no filter; Set() with values = active filter narrowed to
  // the listed source values.
  const [selectedSources, setSelectedSources] =
    React.useState<Set<string> | null>(null);
  const [anchorEl, setAnchorEl] =
    React.useState<HTMLButtonElement | null>(null);

  // Fetch entities matching the base filter + (optional) selected
  // sources. Re-run on any of those changing.
  const { value: entities = [], loading } = useAsync(async (): Promise<Entity[]> => {
    const filter = combineFilters(baseCatalogFilter, selectedSources, sourceAnnotation);
    const resp = await catalogApi.getEntities(filter ? { filter: filter as any } : undefined);
    return (resp.items ?? []) as Entity[];
  }, [
    catalogApi,
    JSON.stringify(baseCatalogFilter),
    selectedSources === null ? null : Array.from(selectedSources).sort().join('|'),
    sourceAnnotation,
  ]);

  // For the source-filter popover: ALWAYS query with the base filter
  // (ignoring the user's source selection) so the popover lists every
  // available source and lets the user widen as well as narrow.
  const { value: sourceOptions = [], loading: sourcesLoading } = useAsync(async (): Promise<SourceOption[]> => {
    const resp = await catalogApi.getEntities(
      baseCatalogFilter ? { filter: baseCatalogFilter as any } : undefined,
    );
    const counts = new Map<string, number>();
    for (const e of (resp.items ?? []) as Entity[]) {
      const v = e.metadata?.annotations?.[sourceAnnotation];
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({
        value,
        label: sourceLabels[value] ?? value,
        count,
      }));
  }, [
    catalogApi,
    JSON.stringify(baseCatalogFilter),
    sourceAnnotation,
    JSON.stringify(sourceLabels),
  ]);

  // Resolve the current value (an entity ref string) into the
  // matching Entity from the loaded list so the Autocomplete shows
  // its label, not the raw ref. Best-effort; if the ref doesn't
  // resolve in the current list we leave it as a free-text fallback.
  const selectedEntity = React.useMemo<Entity | null>(() => {
    if (!formData) return null;
    try {
      const ref = parseEntityRef(formData);
      return (
        entities.find(
          e =>
            e.kind.toLowerCase() === ref.kind.toLowerCase() &&
            e.metadata.namespace?.toLowerCase() ===
              (ref.namespace ?? 'default').toLowerCase() &&
            e.metadata.name.toLowerCase() === ref.name.toLowerCase(),
        ) ?? null
      );
    } catch {
      return null;
    }
  }, [formData, entities]);

  const toggleSource = (value: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev ?? []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };
  const clearFilter = () => setSelectedSources(null);
  const activeCount = selectedSources === null ? 0 : selectedSources.size;

  return (
    <FormControl
      margin="normal"
      required={required}
      error={Boolean(rawErrors?.length) && !formData}
    >
      <div className={classes.wrapper}>
        <div className={classes.pickerColumn}>
          <Autocomplete
            id={idSchema?.$id}
            value={selectedEntity}
            loading={loading}
            options={entities}
            getOptionLabel={entityLabel}
            getOptionSelected={(opt, val) =>
              opt && val
                ? stringifyEntityRef(opt) === stringifyEntityRef(val)
                : false
            }
            onChange={(_e, val) =>
              onChange(val ? stringifyEntityRef(val) : undefined)
            }
            noOptionsText={loading ? 'Loading…' : 'No entities match the current filter.'}
            renderInput={params => (
              <TextField
                {...params}
                label={title}
                margin="dense"
                required={required}
                error={Boolean(rawErrors?.length) && !formData}
                variant="outlined"
              />
            )}
          />
        </div>
        <Tooltip
          title={
            activeCount > 0
              ? `Filtering by ${activeCount} source${activeCount === 1 ? '' : 's'}`
              : 'Filter by source'
          }
        >
          <IconButton
            aria-label="Filter by source"
            onClick={ev => setAnchorEl(ev.currentTarget)}
            className={classes.filterButton}
            color={activeCount > 0 ? 'secondary' : 'default'}
            size="medium"
          >
            <TuneIcon />
            {activeCount > 0 && (
              <span className={classes.activeBadge}>{activeCount}</span>
            )}
          </IconButton>
        </Tooltip>
        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Box className={classes.popoverContent}>
            <Typography variant="subtitle2">Filter by source</Typography>
            <Typography variant="caption" color="textSecondary">
              Narrow the picker to one or more model sources.
            </Typography>
            <Box mt={1} mb={1}>
              <Divider />
            </Box>
            {sourcesLoading && (
              <Typography className={classes.emptyState} variant="body2">
                Loading sources…
              </Typography>
            )}
            {!sourcesLoading && sourceOptions.length === 0 && (
              <Typography className={classes.emptyState} variant="body2">
                No source annotations found on the entities in scope.
              </Typography>
            )}
            {!sourcesLoading && sourceOptions.length > 0 && (
              <FormGroup>
                {sourceOptions.map(opt => {
                  const checked =
                    selectedSources !== null && selectedSources.has(opt.value);
                  return (
                    <FormControlLabel
                      key={opt.value}
                      control={
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleSource(opt.value)}
                          color="primary"
                        />
                      }
                      label={
                        <>
                          {opt.label}
                          <Chip
                            label={opt.count}
                            size="small"
                            className={classes.countChip}
                          />
                        </>
                      }
                    />
                  );
                })}
              </FormGroup>
            )}
            {selectedSources !== null && (
              <Box mt={1}>
                <Divider />
                <Box mt={1}>
                  <Typography
                    variant="caption"
                    color="primary"
                    className={classes.clearLink}
                    onClick={clearFilter}
                  >
                    Clear filter
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        </Popover>
      </div>
      {description && (
        <FormHelperText error={false}>{description}</FormHelperText>
      )}
      {rawErrors && rawErrors.length > 0 && !formData && (
        <FormHelperText error>{rawErrors[0]}</FormHelperText>
      )}
    </FormControl>
  );
};

/**
 * Compose the base filter with the user's source selections. When
 * selectedSources is non-empty, we emit an array of filter objects
 * (one per chosen source) — Backstage's catalog API treats an array
 * as an OR across its members. Each entry inherits the base
 * (non-array) filter's keys so kind / spec.type still apply.
 */
function combineFilters(
  base: CatalogFilter,
  selectedSources: Set<string> | null,
  sourceAnnotation: string,
): CatalogFilter {
  if (selectedSources === null) return base;
  if (selectedSources.size === 0) {
    // Sentinel filter that matches no entity, so the picker shows
    // empty consistent with the popover's all-unchecked state.
    return [
      {
        ...(base && !Array.isArray(base) ? base : {}),
        [`metadata.annotations.${sourceAnnotation}`]: '__none__',
      },
    ];
  }
  const baseObj =
    base && !Array.isArray(base) ? (base as Record<string, unknown>) : undefined;
  return Array.from(selectedSources).map(v => ({
    ...(baseObj ?? {}),
    [`metadata.annotations.${sourceAnnotation}`]: v,
  })) as Record<string, string | string[]>[];
}
